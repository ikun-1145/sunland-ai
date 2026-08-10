import type { KnowledgeRecord, MemoryRecord } from "@sunland-ai/core";

export interface Env {
  USER_BRAINS: DurableObjectNamespace<import("./userBrain").SunlandUserBrain>;
  APP_JWT_PRIMARY_SECRET?: string;
  APP_JWT_LEGACY_SECRET?: string;
  APP_JWT_SECRET?: string;
  APP_JWT_ISSUER?: string;
  SUPABASE_PROJECT_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CORS_ORIGINS: string;
  CORE_VERSION: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface TurnRequest {
  conversationId: string;
  turnId: string;
  input: string;
  observationMode?: "off" | "summary";
}

export interface LegacyContext {
  conversationId: string;
  context: unknown;
}

export interface LegacyMigrationRequest {
  migrationId: string;
  knowledge: readonly KnowledgeRecord[];
  memory: readonly MemoryRecord[];
  contexts: readonly LegacyContext[];
}

export interface BrainSnapshot {
  revision: number;
  knowledge: readonly KnowledgeRecord[];
  memory: readonly MemoryRecord[];
  context: unknown;
}

export interface TurnResponse {
  conversationId: string;
  turnId: string;
  response: string;
  stateRevision: number;
  observationSummary?: unknown;
}
