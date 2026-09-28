import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../src/handler";
import type { Env } from "../src/types";

function env(): Env {
  return {
    APP_JWT_SECRET: "test-secret",
    SUPABASE_URL: "https://database.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-secret",
    CORS_ORIGINS: "https://sunland.dev,https://www.sunland.dev",
    CORE_VERSION: "0.1.0",
    USER_BRAINS: {} as unknown as Env["USER_BRAINS"],
  };
}

function base64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function token(): Promise<string> {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const body = base64url({ id: "user-a", exp: Math.floor(Date.now() / 1000) + 60 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signed)))
    .replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
  return `${header}.${body}.${signature}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public Worker boundary", () => {
  it("reports the deployed Core contract with no cache", async () => {
    const response = await worker.fetch!(
      new Request("https://ai-core.sunland.dev/healthz", {
        headers: { origin: "https://sunland.dev" },
      }),
      env(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://sunland.dev");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "sunland-ai-core",
      coreVersion: "0.1.0",
    });
  });

  it("rejects an untrusted browser origin before authentication", async () => {
    const response = await worker.fetch!(
      new Request("https://ai-core.sunland.dev/v1/knowledge", {
        headers: { origin: "https://attacker.example" },
      }),
      env(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "origin_forbidden" },
    });
  });

  it("propagates a remote parent and returns the same trace ID when telemetry storage fails", async () => {
    const inboundTraceId = "0123456789abcdef0123456789abcdef";
    const inboundSpanId = "0123456789abcdef";
    const writes: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 503 });
    }));
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let forwarded: Request | undefined;
    const configured = env();
    configured.USER_BRAINS = {
      idFromName: () => "object-id",
      get: () => ({ fetch: async (request: Request) => {
        forwarded = request;
        return new Response('{"turnId":"business-id"}', { status: 200 });
      } }),
    } as unknown as Env["USER_BRAINS"];
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (work: Promise<unknown>) => pending.push(work) } as unknown as ExecutionContext;
    const response = await worker.fetch!(new Request("https://ai-core.sunland.dev/v1/turns", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token()}`,
        origin: "https://sunland.dev",
        traceparent: `00-${inboundTraceId}-${inboundSpanId}-00`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ turnId: "business-id", input: "private user prompt" }),
    }), configured, ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-sunland-trace-id")).toBe(inboundTraceId);
    expect(response.headers.get("access-control-expose-headers")).toContain("x-sunland-trace-id");
    expect(await response.json()).toEqual({ turnId: "business-id" });
    expect(forwarded?.headers.get("authorization")).toBeNull();
    expect(forwarded?.headers.get("x-sunland-user-id")).toBe("user-a");
    expect(forwarded?.headers.get("traceparent")).toMatch(new RegExp(`^00-${inboundTraceId}-[0-9a-f]{16}-01$`, "u"));
    await Promise.all(pending);
    const summary = writes.find((write) => write.url.endsWith("/observability_traces"))?.body as Record<string, unknown>;
    const spans = writes.find((write) => write.url.endsWith("/observability_spans"))?.body as Array<Record<string, unknown>>;
    expect(summary).toMatchObject({ trace_id: inboundTraceId, trace_completeness: "UNKNOWN" });
    expect(spans[0]).toMatchObject({ trace_id: inboundTraceId, parent_span_id: inboundSpanId, name: "EDGE_REQUEST" });
    expect(JSON.stringify(writes)).not.toContain("private user prompt");
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it("replaces malformed traceparent without changing the authentication error", async () => {
    const response = await worker.fetch!(new Request("https://ai-core.sunland.dev/v1/turns", {
      method: "POST",
      headers: { traceparent: "00-bad-0000000000000000-zz" },
    }), env());
    expect(response.status).toBe(401);
    expect(response.headers.get("x-sunland-trace-id")).toMatch(/^[0-9a-f]{32}$/u);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "missing_token" } });
  });
});
