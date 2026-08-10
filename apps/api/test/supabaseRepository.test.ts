import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseRepository } from "../src/supabaseRepository";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Supabase repository failure mapping", () => {
  it("loads short-term context by both user and conversation", async () => {
    const request = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", request);
    const repository = new SupabaseRepository(
      "https://database.example",
      "service-secret",
    );

    await repository.loadSnapshot("user/a", "conversation/b");

    const urls = request.mock.calls.map((call) =>
      String((call as unknown as readonly [string])[0]));
    const contextUrl = urls.find((url) => url.includes("/sunland_ai_context?"));
    expect(contextUrl).toContain("user_id=eq.user%2Fa");
    expect(contextUrl).toContain("conversation_id=eq.conversation%2Fb");
  });

  it("distinguishes idempotency-key reuse from a revision retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ message: "turn_id_reused" }),
      { status: 409 },
    )));
    const repository = new SupabaseRepository("https://database.example", "service-secret");

    await expect(repository.commitTurn({
      userId: "user-a",
      conversationId: "conversation-a",
      turnId: "turn-a",
      expectedRevision: 1,
      requestHash: "a".repeat(64),
      knowledge: [],
      memory: [],
      context: { schemaVersion: 1, version: 0, recentTurns: [] },
      response: {
        conversationId: "conversation-a",
        turnId: "turn-a",
        response: "answer",
        stateRevision: 2,
      },
    })).rejects.toMatchObject({ status: 409, code: "turn_id_reused" });
  });

  it("deletes only expired idempotency rows without logging secrets", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    const repository = new SupabaseRepository("https://database.example", "service-secret");
    await repository.deleteExpiredTurnResults(new Date("2026-08-08T03:17:00.000Z"));

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/sunland_ai_turn_results?expires_at=lt.");
    expect(url).not.toContain("service-secret");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer service-secret");
  });

  it("sends a modern secret key only through apikey", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    const repository = new SupabaseRepository(
      "https://database.example",
      "sb_secret_server-key",
    );
    await repository.deleteExpiredTurnResults();

    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBe("sb_secret_server-key");
    expect(headers.get("authorization")).toBeNull();
  });
});
