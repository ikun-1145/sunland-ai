import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseRepository } from "../src/supabaseRepository";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Supabase repository failure mapping", () => {
  it("loads short-term context by both user and conversation", async () => {
    const request = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "0-0/0" },
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

describe("Supabase repository complete reads", () => {
  function page(prefix: string, from: number, to: number, total: number): Response {
    const rows = [];
    for (let index = from; index <= to; index += 1) {
      rows.push({
        id: `${prefix}_${index}`,
        subject: `s_${index}`,
        relation: "属于",
        object: `o_${index}`,
        negated: false,
        confidence: 1,
        source: "user",
        created_at: new Date(1_700_000_000_000 + index).toISOString(),
      });
    }
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": `${from}-${to}/${total}`,
      },
    });
  }

  function knowledgePage(from: number, to: number, total: number): Response {
    return page("k", from, Math.min(to, total - 1), total);
  }

  function memoryPage(from: number, to: number, total: number): Response {
    return page("m", from, Math.min(to, total - 1), total);
  }

  function routedFetch(handlers: {
    knowledge?: (from: number, to: number) => Response;
    memory?: (from: number, to: number) => Response;
  }): ReturnType<typeof vi.fn> {
    const empty = (): Response => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "0-0/0" },
    });
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const range = new Headers(init?.headers).get("range") ?? "0-0";
      const [fromText, toText] = range.split("-");
      const from = Number(fromText);
      const to = Number(toText);
      if (url.includes("/sunland_ai_knowledge?")) {
        return handlers.knowledge?.(from, to) ?? empty();
      }
      if (url.includes("/sunland_ai_memory?")) {
        return handlers.memory?.(from, to) ?? empty();
      }
      return empty();
    });
  }

  it("pages through knowledge instead of returning only the server's first page", async () => {
    const knowledgeRanges: string[] = [];
    const fetchMock = routedFetch({
      knowledge: (from, to) => {
        knowledgeRanges.push(`${from}-${to}`);
        return knowledgePage(from, to, 3000);
      },
      memory: (from, to) => memoryPage(from, to, 2),
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new SupabaseRepository("https://database.example", "service-secret");

    const snapshot = await repository.loadSnapshot("user-a", "conversation-a");

    expect(snapshot.knowledge).toHaveLength(3000);
    expect(snapshot.knowledge[0]?.id).toBe("k_0");
    expect(snapshot.knowledge[2999]?.id).toBe("k_2999");
    // One request per page, each asking for exactly the next window.
    expect(knowledgeRanges).toEqual(["0-999", "1000-1999", "2000-2999"]);
  });

  it("fails closed when the server cannot prove the read is complete", async () => {
    // A single unpaginated read with no Content-Range total: we cannot tell a
    // complete result from a truncated one, so the turn must fail rather than
    // answer from a partial knowledge base.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const repository = new SupabaseRepository("https://database.example", "service-secret");

    await expect(repository.loadSnapshot("user-a", "conversation-a"))
      .rejects.toMatchObject({ status: 503, code: "persistence_unavailable" });
  });

  it("fails closed when a page stops making progress", async () => {
    // Header claims 3000 rows but every page returns none: returning the two
    // empty pages as a successful snapshot would be a silent truncation.
    vi.stubGlobal("fetch", routedFetch({
      knowledge: () => new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "content-range": "0-0/3000" },
      }),
    }));
    const repository = new SupabaseRepository("https://database.example", "service-secret");

    await expect(repository.loadSnapshot("user-a", "conversation-a"))
      .rejects.toMatchObject({ status: 503, code: "persistence_unavailable" });
  });

  it("treats a total of unknown (*) as unprovable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/sunland_ai_knowledge?")
        ? new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json", "content-range": "0-0/*" },
          })
        : new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json", "content-range": "0-0/0" },
          })));
    const repository = new SupabaseRepository("https://database.example", "service-secret");

    await expect(repository.loadSnapshot("user-a", "conversation-a"))
      .rejects.toMatchObject({ status: 503, code: "persistence_unavailable" });
  });

  it("stops cleanly when rows disappear between pages", async () => {
    // Far fewer rows exist than the first page claimed, so the next window
    // starts past the end and PostgREST answers 416. That is "nothing left",
    // not a failed turn.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("/sunland_ai_knowledge?")) {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json", "content-range": "0-0/0" },
        });
      }
      const range = new Headers(init?.headers).get("range") ?? "0-0";
      if (range.startsWith("0-")) return knowledgePage(0, 999, 5000);
      return new Response(null, { status: 416 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new SupabaseRepository("https://database.example", "service-secret");

    const snapshot = await repository.loadSnapshot("user-a", "conversation-a");

    expect(snapshot.knowledge).toHaveLength(1000);
  });
});
