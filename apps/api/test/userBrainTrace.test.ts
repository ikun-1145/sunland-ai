import { afterEach, describe, expect, it, vi } from "vitest";

const { repository, executeTurn } = vi.hoisted(() => ({
  repository: {
    getTurnResult: vi.fn(),
    loadSnapshot: vi.fn(),
    commitTurn: vi.fn(),
  },
  executeTurn: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));
vi.mock("../src/supabaseRepository", () => ({
  SupabaseRepository: class { constructor() { return repository; } },
  RevisionConflictError: class extends Error {},
}));
vi.mock("../src/coreSession", () => ({ executeTurn }));

import { SunlandUserBrain } from "../src/userBrain";
import type { Env } from "../src/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Core Durable Object trace", () => {
  it("records engine and persistence boundaries without changing the turn when telemetry fails", async () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    const parentId = "fedcba9876543210";
    const savedBodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      savedBodies.push(String(init.body));
      return new Response(null, { status: 503 });
    }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    repository.getTurnResult.mockResolvedValue(null);
    repository.loadSnapshot.mockResolvedValue({ revision: 0, knowledge: [], memory: [], context: {} });
    executeTurn.mockReturnValue({ response: "safe reply", knowledge: [], memory: [], context: {} });
    repository.commitTurn.mockResolvedValue({
      conversationId: "conversation-a", turnId: "business-turn-id", response: "safe reply", stateRevision: 1,
    });
    const pending: Promise<unknown>[] = [];
    const ctx = {
      storage: { get: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) },
      waitUntil: (work: Promise<unknown>) => pending.push(work),
    } as unknown as DurableObjectState;
    const env = {
      SUPABASE_URL: "https://database.example",
      SUPABASE_SERVICE_ROLE_KEY: "service-secret",
    } as Env;
    const brain = new SunlandUserBrain(ctx, env);
    const response = await brain.fetch(new Request("https://ai-core.sunland.dev/v1/turns", {
      method: "POST",
      headers: {
        "x-sunland-user-id": "verified-user",
        traceparent: `00-${traceId}-${parentId}-00`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversationId: "conversation-a", turnId: "business-turn-id", input: "private input" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversationId: "conversation-a", turnId: "business-turn-id", response: "safe reply", stateRevision: 1,
    });
    await Promise.all(pending);
    expect(savedBodies).toHaveLength(1);
    const spans = JSON.parse(savedBodies[0] ?? "[]") as Array<Record<string, unknown>>;
    expect(spans.map((span) => span.name)).toEqual([
      "PERSISTENCE", "PERSISTENCE", "CORE_ENGINE", "PERSISTENCE",
    ]);
    expect(spans.every((span) => span.trace_id === traceId && span.parent_span_id === parentId)).toBe(true);
    expect(savedBodies[0]).not.toContain("private input");
    expect(savedBodies[0]).not.toContain("verified-user");
  });
});
