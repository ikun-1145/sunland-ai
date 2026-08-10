import { DurableObject } from "cloudflare:workers";

import { executeTurn } from "./coreSession";
import { supabaseServerConfig } from "./config";
import { boundedText, HttpError, jsonResponse, readJson, sha256 } from "./http";
import { RevisionConflictError, SupabaseRepository } from "./supabaseRepository";
import type { Env, TurnResponse } from "./types";
import { validateMigrationRequest, validateTurnRequest } from "./validation";

interface RateWindow {
  startedAt: number;
  count: number;
}

export class SunlandUserBrain extends DurableObject<Env> {
  private readonly repository: SupabaseRepository;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const { url, serverKey } = supabaseServerConfig(env);
    this.repository = new SupabaseRepository(url, serverKey);
  }

  private async assertRateLimit(): Promise<void> {
    const now = Date.now();
    const stored = await this.ctx.storage.get<RateWindow>("rate-window");
    const window = stored && now - stored.startedAt < 60_000
      ? stored
      : { startedAt: now, count: 0 };
    if (window.count >= 60) {
      throw new HttpError(429, "rate_limited", "请求过于频繁，请稍后重试。");
    }
    await this.ctx.storage.put("rate-window", { ...window, count: window.count + 1 });
  }

  async fetch(request: Request): Promise<Response> {
    await this.assertRateLimit();
    const userId = request.headers.get("x-sunland-user-id");
    if (!userId) throw new HttpError(401, "missing_identity", "缺少已验证身份。");
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/v1/turns") {
      return await this.turn(userId, request);
    }
    if (request.method === "POST" && url.pathname === "/v1/migrations/local-state") {
      return await this.importLegacyState(userId, request);
    }
    if (request.method === "GET" && url.pathname === "/v1/knowledge") {
      return await this.listKnowledge(userId, url);
    }
    if (request.method === "DELETE" && url.pathname === "/v1/knowledge") {
      await this.repository.deleteKnowledge(userId);
      return new Response(null, { status: 204 });
    }
    const knowledgeMatch = /^\/v1\/knowledge\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "DELETE" && knowledgeMatch?.[1]) {
      await this.repository.deleteKnowledge(userId, decodeURIComponent(knowledgeMatch[1]));
      return new Response(null, { status: 204 });
    }
    if (request.method === "DELETE" && url.pathname === "/v1/memory/name") {
      await this.repository.deleteMemoryName(userId);
      return new Response(null, { status: 204 });
    }
    const contextMatch = /^\/v1\/conversations\/([^/]+)\/context$/u.exec(url.pathname);
    if (request.method === "DELETE" && contextMatch?.[1]) {
      await this.repository.deleteContext(
        userId,
        boundedText(decodeURIComponent(contextMatch[1]), "conversationId", 128),
      );
      return new Response(null, { status: 204 });
    }
    throw new HttpError(404, "not_found", "接口不存在。");
  }

  private async turn(userId: string, request: Request): Promise<Response> {
    const turn = validateTurnRequest(await readJson(request));
    const requestHash = await sha256(JSON.stringify(turn));
    const existing = await this.repository.getTurnResult(userId, turn.turnId);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new HttpError(409, "turn_id_reused", "turnId 已被另一请求使用。");
      }
      return jsonResponse(existing.response);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await this.repository.loadSnapshot(userId, turn.conversationId);
      const executed = executeTurn(snapshot, turn);
      const response: TurnResponse = {
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        response: executed.response,
        stateRevision: snapshot.revision + 1,
        ...(executed.observationSummary === undefined
          ? {}
          : { observationSummary: executed.observationSummary }),
      };
      try {
        const committed = await this.repository.commitTurn({
          userId,
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          expectedRevision: snapshot.revision,
          requestHash,
          knowledge: executed.knowledge,
          memory: executed.memory,
          context: executed.context,
          response,
        });
        return jsonResponse(committed);
      } catch (error) {
        if (!(error instanceof RevisionConflictError) || attempt === 1) throw error;
      }
    }
    throw new HttpError(409, "revision_conflict", "状态已变化，请使用同一 turnId 重试。");
  }

  private async importLegacyState(userId: string, request: Request): Promise<Response> {
    const migration = validateMigrationRequest(await readJson(request, 8 * 1024 * 1024));
    const payloadHash = await sha256(JSON.stringify(migration));
    const receipt = await this.repository.importLegacyState(userId, payloadHash, migration);
    return jsonResponse(receipt);
  }

  private async listKnowledge(userId: string, url: URL): Promise<Response> {
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
    const cursor = url.searchParams.get("cursor") || undefined;
    if (cursor && cursor.length > 128) throw new HttpError(400, "invalid_cursor", "分页游标无效。");
    const records = await this.repository.listKnowledge(userId, limit + 1, cursor);
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    return jsonResponse({
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
    });
  }
}
