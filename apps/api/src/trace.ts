import { supabaseServerConfig } from "./config";
import type { Env } from "./types";

const TRACE_ID = /^[0-9a-f]{32}$/u;
const SPAN_ID = /^[0-9a-f]{16}$/u;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;
export const MAX_SPANS_PER_TRACE = 32;
const SLOW_TRACE_MS = 15_000;

export interface TraceParent {
  traceId: string;
  spanId: string;
  flags: string;
}

export interface TraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service: "sunland-core";
  name: "EDGE_REQUEST" | "CORE_ENGINE" | "PERSISTENCE";
  started_at: string;
  duration_ms: number;
  status: "OK" | "ERROR" | "CANCELLED" | "REJECTED";
  error_code: string | null;
  service_version: string;
  environment: "production" | "staging" | "development" | "unknown";
  deployment_id: string | null;
  metadata: Record<string, string>;
  expires_at: string;
}

export interface TraceSummary {
  trace_id: string;
  started_at: string;
  ended_at: string;
  entry_service: "sunland-core";
  route_key: "/v1/turns";
  outcome: TraceSpan["status"];
  http_status: number;
  error_code: string | null;
  duration_ms: number;
  sample_reason: "phase2_full";
  trace_completeness: "UNKNOWN";
  service_version: string;
  environment: "production" | "staging" | "development" | "unknown";
  deployment_id: string | null;
  attributes: Record<string, string>;
  expires_at: string;
}

export interface ActiveSpan {
  readonly startedTick: number;
  readonly span: Omit<TraceSpan, "duration_ms" | "status" | "error_code" | "expires_at">;
}

function randomHex(length: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateTraceId(): string {
  let id: string;
  do id = randomHex(16); while (/^0+$/u.test(id));
  return id;
}

export function generateSpanId(): string {
  let id: string;
  do id = randomHex(8); while (/^0+$/u.test(id));
  return id;
}

export function parseTraceparent(value: string | null): TraceParent | null {
  const match = value === null ? null : TRACEPARENT.exec(value);
  const traceId = match?.[1];
  const spanId = match?.[2];
  const flags = match?.[3];
  if (!traceId || !spanId || !flags || /^0+$/u.test(traceId) || /^0+$/u.test(spanId)) return null;
  return { traceId, spanId, flags };
}

export function validateTraceparent(value: string | null): boolean {
  return parseTraceparent(value) !== null;
}

export function createTraceparent(traceId: string, spanId: string, flags = "01"): string {
  if (!TRACE_ID.test(traceId) || /^0+$/u.test(traceId)
    || !SPAN_ID.test(spanId) || /^0+$/u.test(spanId)
    || !/^[0-9a-f]{2}$/u.test(flags)) {
    throw new TypeError("invalid trace context");
  }
  return `00-${traceId}-${spanId}-${flags}`;
}

export function telemetryErrorCode(code: string, fallback = "INTERNAL_ERROR"): string {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(code) ? code.toUpperCase() : fallback;
}

// Default-deny: values are fixed categories, never caller text or error bodies.
export function redactTelemetry(value: Record<string, unknown>, maximumBytes = 1024): Record<string, string> {
  const safe: Record<string, string> = {};
  const operation = value.operation;
  if (operation === "get_turn_result" || operation === "load_snapshot" || operation === "commit_turn") {
    safe.operation = operation;
  }
  if (value.trust_level === "server_observed") safe.trust_level = "server_observed";
  if (typeof value.dropped_span_count === "number"
    && Number.isSafeInteger(value.dropped_span_count)
    && value.dropped_span_count > 0 && value.dropped_span_count <= 10_000) {
    safe.dropped_span_count = String(value.dropped_span_count);
  }
  return new TextEncoder().encode(JSON.stringify(safe)).byteLength <= maximumBytes ? safe : {};
}

export function serviceIdentity(env: Env): {
  serviceVersion: string;
  environment: TraceSpan["environment"];
  deploymentId: string | null;
} {
  const environment = env.TRACE_ENVIRONMENT;
  return {
    serviceVersion: "UNVERIFIED",
    environment: environment === "production" || environment === "staging" || environment === "development"
      ? environment : "unknown",
    deploymentId: env.CF_VERSION_METADATA?.id ?? null,
  };
}

export function createSpan(
  traceId: string,
  parentSpanId: string | null,
  name: TraceSpan["name"],
  env: Env,
  metadata: Record<string, unknown> = {},
): ActiveSpan {
  const identity = serviceIdentity(env);
  let spanId: string;
  do spanId = generateSpanId(); while (spanId === parentSpanId);
  return {
    startedTick: performance.now(),
    span: {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      service: "sunland-core",
      name,
      started_at: new Date().toISOString(),
      service_version: identity.serviceVersion,
      environment: identity.environment,
      deployment_id: identity.deploymentId,
      metadata: redactTelemetry({ ...metadata, trust_level: "server_observed" }),
    },
  };
}

export function finishSpan(
  active: ActiveSpan,
  status: TraceSpan["status"] = "OK",
  errorCode: string | null = null,
): TraceSpan {
  const durationMs = Math.max(0, Math.round(performance.now() - active.startedTick));
  const expiresAt = new Date(Date.now() + (status === "OK" && durationMs < SLOW_TRACE_MS ? 7 : 30) * 86_400_000).toISOString();
  return {
    ...active.span,
    duration_ms: durationMs,
    status,
    error_code: errorCode,
    expires_at: expiresAt,
  };
}

async function writeRows(env: Env, table: "observability_traces" | "observability_spans", rows: unknown): Promise<void> {
  const { url, serverKey } = supabaseServerConfig(env);
  const headers = new Headers({
    apikey: serverKey,
    "content-type": "application/json",
    prefer: "resolution=ignore-duplicates,return=minimal",
  });
  if (!serverKey.startsWith("sb_secret_")) headers.set("authorization", `Bearer ${serverKey}`);
  const response = await fetch(`${url.replace(/\/$/u, "")}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`telemetry ${table} status ${response.status}`);
}

export async function recordTrace(env: Env, summary: TraceSummary): Promise<void> {
  await writeRows(env, "observability_traces", summary);
}

export async function recordSpans(env: Env, spans: readonly TraceSpan[]): Promise<void> {
  if (spans.length === 0) return;
  const bounded = spans.slice(0, MAX_SPANS_PER_TRACE);
  if (spans.length > MAX_SPANS_PER_TRACE) {
    const last = bounded[MAX_SPANS_PER_TRACE - 1];
    if (last) {
      bounded[MAX_SPANS_PER_TRACE - 1] = {
        ...last,
        metadata: redactTelemetry({ ...last.metadata, dropped_span_count: spans.length - MAX_SPANS_PER_TRACE }),
      };
    }
  }
  await writeRows(env, "observability_spans", bounded);
}

export async function recordSafely(
  traceId: string,
  table: "observability_traces" | "observability_spans",
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch {
    console.warn("OBSERVABILITY_WRITE_FAILED", { trace_id: traceId, table });
  }
}
