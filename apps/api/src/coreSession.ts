import {
  applySemanticContextUpdate,
  createSunlandEngine,
  type KnowledgeRecord,
  type MemoryRecord,
  type StorageAdapter,
} from "@sunland-ai/core";

import type { BrainSnapshot, TurnRequest } from "./types";

const STORAGE_KEY = "sunland-server-brain";

class SnapshotStorage implements StorageAdapter {
  private readonly values = new Map<string, string>();

  constructor(snapshot: BrainSnapshot) {
    this.values.set(STORAGE_KEY, JSON.stringify(snapshot.knowledge));
    this.values.set(`${STORAGE_KEY}::memory`, JSON.stringify(snapshot.memory));
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export interface ExecutedTurn {
  response: string;
  observationSummary?: unknown;
  knowledge: readonly KnowledgeRecord[];
  memory: readonly MemoryRecord[];
  context: unknown;
}

export function executeTurn(snapshot: BrainSnapshot, request: TurnRequest): ExecutedTurn {
  const adapter = new SnapshotStorage(snapshot);
  const engine = createSunlandEngine({
    storage: { adapter, key: STORAGE_KEY },
    semanticMode: "passive",
    semanticContextMode: "enabled",
  });
  const result = engine.process(request.input, {
    semanticContext: snapshot.context,
    turnId: request.turnId,
    canCommitSemanticContext: () => true,
    ...(request.observationMode === "summary" ? { observationMode: "summary" } : {}),
  });
  const context = applySemanticContextUpdate(snapshot.context, result.semanticContextUpdate);

  return {
    response: result.response,
    ...(result.observationSummary === undefined ? {} : { observationSummary: result.observationSummary }),
    knowledge: engine.knowledgeStore.all(),
    memory: engine.memory.list(),
    context,
  };
}
