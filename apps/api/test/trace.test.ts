import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSpan,
  createTraceparent,
  finishSpan,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  recordSpans,
  redactTelemetry,
  telemetryErrorCode,
  validateTraceparent,
} from "../src/trace";
import type { Env } from "../src/types";

const env = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe("W3C trace context", () => {
  it("generates cryptographically random lowercase IDs and preserves a valid parent", () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    expect(traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/u);
    expect(parseTraceparent(createTraceparent(traceId, spanId))).toEqual({ traceId, spanId, flags: "01" });
  });

  it.each([
    "00-00000000000000000000000000000000-0123456789abcdef-01",
    "00-0123456789abcdef0123456789abcdef-0000000000000000-01",
    "00-0123456789abcdef0123456789abcde-0123456789abcdef-01",
    "00-0123456789abcdef0123456789abcdeg-0123456789abcdef-01",
    "01-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    "00-0123456789abcdef0123456789abcdef-0123456789abcdef-zz",
    "00-0123456789ABCDEF0123456789abcdef-0123456789abcdef-01",
  ])("rejects invalid traceparent %s", (value) => {
    expect(validateTraceparent(value)).toBe(false);
    expect(parseTraceparent(value)).toBeNull();
  });
});

describe("safe Core telemetry", () => {
  it("keeps only fixed metadata categories and safe error codes", () => {
    const secret = "jwt email@example.com https://img.example/private?token=secret";
    const metadata = redactTelemetry({
      operation: "commit_turn",
      trust_level: "server_observed",
      prompt: secret,
      response: secret,
      authorization: secret,
      provider_body: secret,
    });
    expect(metadata).toEqual({ operation: "commit_turn", trust_level: "server_observed" });
    expect(JSON.stringify(metadata)).not.toContain(secret);
    expect(redactTelemetry({ operation: "commit_turn" }, 1)).toEqual({});
    expect(telemetryErrorCode("invalid_token")).toBe("INVALID_TOKEN");
    expect(telemetryErrorCode(secret)).toBe("INTERNAL_ERROR");
  });

  it("caps each batched write at 32 spans", async () => {
    const body = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", body);
    const traceId = generateTraceId();
    const spans = Array.from({ length: 33 }, () => finishSpan(createSpan(traceId, null, "CORE_ENGINE", env)));
    await recordSpans(env, spans);
    const init = body.mock.calls[0]?.[1] as RequestInit;
    const saved = JSON.parse(String(init.body)) as unknown[];
    expect(saved).toHaveLength(32);
    expect(saved[31]).toMatchObject({ metadata: { dropped_span_count: "1" } });
    expect(JSON.stringify(saved)).not.toContain("secret");
  });

  it("keeps a successful slow span for thirty days", () => {
    const active = createSpan(generateTraceId(), null, "CORE_ENGINE", env);
    const row = finishSpan({ ...active, startedTick: active.startedTick - 16_000 });
    expect(row.duration_ms).toBeGreaterThanOrEqual(15_000);
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });
});
