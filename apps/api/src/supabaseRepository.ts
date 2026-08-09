import type { KnowledgeRecord, MemoryRecord } from "@sunland-ai/core";

import { HttpError } from "./http";
import type { BrainSnapshot, LegacyMigrationRequest, TurnResponse } from "./types";

interface StateRow { revision: number | string }
interface KnowledgeRow {
  id: string;
  subject: string;
  relation: string;
  object: string;
  negated: boolean;
  confidence: number | string;
  source: KnowledgeRecord["source"];
  created_at: string;
}
interface MemoryRow {
  id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}
interface ContextRow { context: unknown }
interface TurnResultRow { request_hash: string; response: TurnResponse }

export class RevisionConflictError extends Error {}

export class SupabaseRepository {
  private readonly baseUrl: string;

  constructor(url: string, private readonly serviceRoleKey: string) {
    this.baseUrl = `${url.replace(/\/$/u, "")}/rest/v1`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.serviceRoleKey);
    headers.set("authorization", `Bearer ${this.serviceRoleKey}`);
    headers.set("content-type", "application/json");
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const detail = await response.text();
      if (detail.includes("40001") || detail.includes("revision_conflict")) {
        throw new RevisionConflictError("revision conflict");
      }
      if (detail.includes("turn_id_reused")) {
        throw new HttpError(409, "turn_id_reused", "turnId 已被另一请求使用。");
      }
      if (detail.includes("migration_id_reused")) {
        throw new HttpError(409, "migration_id_reused", "migrationId 已被另一份数据使用。");
      }
      console.error("supabase_request_failed", {
        status: response.status,
        path: path.split("?")[0],
        requestId: response.headers.get("x-request-id"),
      });
      throw new HttpError(503, "persistence_unavailable", "AI 记忆服务暂时不可用，请使用同一请求重试。\n");
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  async getTurnResult(userId: string, turnId: string): Promise<TurnResultRow | null> {
    const rows = await this.request<TurnResultRow[]>(
      `/sunland_ai_turn_results?select=request_hash,response&user_id=eq.${encodeURIComponent(userId)}&turn_id=eq.${encodeURIComponent(turnId)}&limit=1`,
    );
    return rows[0] ?? null;
  }

  async loadSnapshot(userId: string, conversationId: string): Promise<BrainSnapshot> {
    const encodedUser = encodeURIComponent(userId);
    const [states, knowledge, memory, contexts] = await Promise.all([
      this.request<StateRow[]>(`/sunland_ai_user_state?select=revision&user_id=eq.${encodedUser}&limit=1`),
      this.request<KnowledgeRow[]>(`/sunland_ai_knowledge?select=id,subject,relation,object,negated,confidence,source,created_at&user_id=eq.${encodedUser}&order=created_at.asc,id.asc`),
      this.request<MemoryRow[]>(`/sunland_ai_memory?select=id,key,value,created_at,updated_at&user_id=eq.${encodedUser}&order=key.asc`),
      this.request<ContextRow[]>(`/sunland_ai_context?select=context&user_id=eq.${encodedUser}&conversation_id=eq.${encodeURIComponent(conversationId)}&limit=1`),
    ]);
    return {
      revision: Number(states[0]?.revision ?? 0),
      knowledge: knowledge.map((row) => ({
        id: row.id,
        subject: row.subject,
        relation: row.relation,
        object: row.object,
        negated: row.negated,
        confidence: Number(row.confidence),
        source: row.source,
        createdAt: row.created_at,
      })),
      memory: memory.map((row) => ({
        id: row.id,
        key: row.key,
        value: row.value,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      context: contexts[0]?.context ?? null,
    };
  }

  async commitTurn(options: {
    userId: string;
    conversationId: string;
    turnId: string;
    expectedRevision: number;
    requestHash: string;
    knowledge: readonly KnowledgeRecord[];
    memory: readonly MemoryRecord[];
    context: unknown;
    response: TurnResponse;
  }): Promise<TurnResponse> {
    const result = await this.request<TurnResponse>("/rpc/sunland_commit_turn", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: options.userId,
        p_conversation_id: options.conversationId,
        p_turn_id: options.turnId,
        p_expected_revision: options.expectedRevision,
        p_request_hash: options.requestHash,
        p_knowledge: options.knowledge,
        p_memory: options.memory,
        p_context: options.context,
        p_response: options.response,
        p_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    return result;
  }

  async importLegacyState(
    userId: string,
    payloadHash: string,
    migration: LegacyMigrationRequest,
  ): Promise<unknown> {
    return await this.request<unknown>("/rpc/sunland_import_legacy_state", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: userId,
        p_migration_id: migration.migrationId,
        p_payload_hash: payloadHash,
        p_knowledge: migration.knowledge,
        p_memory: migration.memory,
        p_contexts: migration.contexts,
      }),
    });
  }

  async listKnowledge(userId: string, limit: number, afterId?: string): Promise<readonly KnowledgeRecord[]> {
    const after = afterId ? `&id=gt.${encodeURIComponent(afterId)}` : "";
    const rows = await this.request<KnowledgeRow[]>(
      `/sunland_ai_knowledge?select=id,subject,relation,object,negated,confidence,source,created_at&user_id=eq.${encodeURIComponent(userId)}${after}&order=id.asc&limit=${limit}`,
    );
    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      relation: row.relation,
      object: row.object,
      negated: row.negated,
      confidence: Number(row.confidence),
      source: row.source,
      createdAt: row.created_at,
    }));
  }

  async deleteKnowledge(userId: string, id?: string): Promise<void> {
    const idFilter = id ? `&id=eq.${encodeURIComponent(id)}` : "";
    await this.request<void>(
      `/sunland_ai_knowledge?user_id=eq.${encodeURIComponent(userId)}${idFilter}`,
      { method: "DELETE", headers: { prefer: "return=minimal" } },
    );
  }

  async deleteMemoryName(userId: string): Promise<void> {
    await this.request<void>(
      `/sunland_ai_memory?user_id=eq.${encodeURIComponent(userId)}&key=eq.name`,
      { method: "DELETE", headers: { prefer: "return=minimal" } },
    );
  }

  async deleteContext(userId: string, conversationId: string): Promise<void> {
    await this.request<void>(
      `/sunland_ai_context?user_id=eq.${encodeURIComponent(userId)}&conversation_id=eq.${encodeURIComponent(conversationId)}`,
      { method: "DELETE", headers: { prefer: "return=minimal" } },
    );
  }

  async deleteExpiredTurnResults(now = new Date()): Promise<void> {
    await this.request<void>(
      `/sunland_ai_turn_results?expires_at=lt.${encodeURIComponent(now.toISOString())}`,
      { method: "DELETE", headers: { prefer: "return=minimal" } },
    );
  }
}
