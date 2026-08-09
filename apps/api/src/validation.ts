import type { KnowledgeRecord, MemoryRecord } from "@sunland-ai/core";

import { boundedText, HttpError, isRecord } from "./http";
import type { LegacyMigrationRequest, TurnRequest } from "./types";

const SOURCES = new Set(["user", "inference", "seed", "import"]);

function isoTimestamp(value: unknown, field: string): string {
  const text = boundedText(value, field, 64);
  if (!Number.isFinite(Date.parse(text))) {
    throw new HttpError(400, "invalid_request", `${field} 不是有效时间。`);
  }
  return new Date(text).toISOString();
}

function knowledgeRecord(value: unknown): KnowledgeRecord {
  if (!isRecord(value)) throw new HttpError(400, "invalid_legacy_state", "知识记录格式错误。\n");
  const confidence = value.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new HttpError(400, "invalid_legacy_state", "知识可信度超出范围。\n");
  }
  if (!SOURCES.has(String(value.source))) {
    throw new HttpError(400, "invalid_legacy_state", "知识来源无效。\n");
  }
  if (typeof value.negated !== "boolean") {
    throw new HttpError(400, "invalid_legacy_state", "知识否定标记无效。\n");
  }
  return {
    id: boundedText(value.id, "knowledge.id", 128),
    subject: boundedText(value.subject, "knowledge.subject", 256),
    relation: boundedText(value.relation, "knowledge.relation", 128),
    object: boundedText(value.object, "knowledge.object", 512),
    negated: value.negated,
    confidence,
    source: String(value.source) as KnowledgeRecord["source"],
    createdAt: isoTimestamp(value.createdAt, "knowledge.createdAt"),
  };
}

function memoryRecord(value: unknown): MemoryRecord {
  if (!isRecord(value)) throw new HttpError(400, "invalid_legacy_state", "记忆记录格式错误。\n");
  const createdAt = isoTimestamp(value.createdAt, "memory.createdAt");
  const updatedAt = isoTimestamp(value.updatedAt, "memory.updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new HttpError(400, "invalid_legacy_state", "记忆更新时间早于创建时间。\n");
  }
  return {
    id: boundedText(value.id, "memory.id", 128),
    key: boundedText(value.key, "memory.key", 64),
    value: boundedText(value.value, "memory.value", 1024),
    createdAt,
    updatedAt,
  };
}

export function validateTurnRequest(value: unknown): TurnRequest {
  if (!isRecord(value)) throw new HttpError(400, "invalid_request", "请求格式错误。\n");
  const observationMode = value.observationMode ?? "off";
  if (observationMode !== "off" && observationMode !== "summary") {
    throw new HttpError(400, "invalid_request", "observationMode 无效。\n");
  }
  return {
    conversationId: boundedText(value.conversationId, "conversationId", 128),
    turnId: boundedText(value.turnId, "turnId", 128),
    input: boundedText(value.input, "input", 4000),
    observationMode,
  };
}

export function validateMigrationRequest(value: unknown): LegacyMigrationRequest {
  if (!isRecord(value)) throw new HttpError(400, "invalid_request", "请求格式错误。\n");
  if (!Array.isArray(value.knowledge) || value.knowledge.length > 5000) {
    throw new HttpError(400, "invalid_legacy_state", "旧知识数量无效。\n");
  }
  if (!Array.isArray(value.memory) || value.memory.length > 100) {
    throw new HttpError(400, "invalid_legacy_state", "旧记忆数量无效。\n");
  }
  if (!Array.isArray(value.contexts) || value.contexts.length > 500) {
    throw new HttpError(400, "invalid_legacy_state", "旧会话上下文数量无效。\n");
  }

  return {
    migrationId: boundedText(value.migrationId, "migrationId", 128),
    knowledge: value.knowledge.map(knowledgeRecord),
    memory: value.memory.map(memoryRecord),
    contexts: value.contexts.map((entry) => {
      if (!isRecord(entry)) throw new HttpError(400, "invalid_legacy_state", "旧会话上下文格式错误。\n");
      if (
        !isRecord(entry.context) ||
        entry.context.schemaVersion !== 1 ||
        !Number.isSafeInteger(entry.context.version) ||
        Number(entry.context.version) < 0 ||
        !Array.isArray(entry.context.recentTurns)
      ) {
        throw new HttpError(400, "invalid_legacy_state", "旧会话上下文版本无效。");
      }
      return {
        conversationId: boundedText(entry.conversationId, "context.conversationId", 128),
        context: entry.context,
      };
    }),
  };
}
