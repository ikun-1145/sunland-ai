import { authenticate } from "./auth";
import { applicationVerificationSecrets, supabaseServerConfig } from "./config";
import { errorResponse, HttpError, jsonResponse } from "./http";
import { SupabaseRepository } from "./supabaseRepository";
import {
  createSpan,
  createTraceparent,
  finishSpan,
  generateTraceId,
  parseTraceparent,
  recordSafely,
  recordSpans,
  recordTrace,
  serviceIdentity,
  telemetryErrorCode,
} from "./trace";
import type { Env } from "./types";

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowlist = new Set(env.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean));
  return allowlist.has(origin) ? origin : null;
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-expose-headers", "retry-after,x-sunland-trace-id");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handle(request: Request, env: Env, traceparent: string): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse({ status: "ok", service: "sunland-ai-core", coreVersion: env.CORE_VERSION });
  }

  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(request, env)) {
    throw new HttpError(403, "origin_forbidden", "请求来源不受信任。");
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-headers": "authorization,content-type,traceparent",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-max-age": "86400",
      },
    });
  }

  const user = await authenticate(request, applicationVerificationSecrets(env), env.APP_JWT_ISSUER);
  const id = env.USER_BRAINS.idFromName(user.id);
  const stub = env.USER_BRAINS.get(id);
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("tracestate");
  headers.delete("baggage");
  headers.set("traceparent", traceparent);
  headers.set("x-sunland-user-id", user.id);
  return await stub.fetch(new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // Streamed request bodies require this in Node's fetch and are accepted by Workers.
    duplex: "half",
    redirect: "manual",
  } as RequestInit & { duplex: "half" }));
}

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const origin = allowedOrigin(request, env);
    const inbound = parseTraceparent(request.headers.get("traceparent"));
    const traceId = inbound?.traceId ?? generateTraceId();
    // EDGE_REQUEST ends when the Worker creates the response, not when a streamed body is consumed.
    const edge = createSpan(traceId, inbound?.spanId ?? null, "EDGE_REQUEST", env);
    let response: Response;
    let errorCode: string | null = null;
    try {
      response = await handle(request, env, createTraceparent(traceId, edge.span.span_id));
    } catch (error) {
      errorCode = error instanceof HttpError
        ? telemetryErrorCode(error.code) : "INTERNAL_ERROR";
      if (!(error instanceof HttpError)) console.error("unhandled_request_error", { trace_id: traceId });
      response = errorResponse(error);
    }
    const status = response.status >= 500 ? "ERROR" as const
      : response.status >= 400 ? "REJECTED" as const : "OK" as const;
    const edgeSpan = finishSpan(edge, status, errorCode);
    if (request.method === "POST" && new URL(request.url).pathname === "/v1/turns" && ctx) {
      const { serviceVersion, environment, deploymentId } = serviceIdentity(env);
      const summary = {
        trace_id: traceId,
        started_at: edgeSpan.started_at,
        ended_at: new Date().toISOString(),
        entry_service: "sunland-core" as const,
        route_key: "/v1/turns" as const,
        outcome: status,
        http_status: response.status,
        error_code: errorCode,
        duration_ms: edgeSpan.duration_ms,
        sample_reason: "phase2_full" as const,
        // DO span writes are independent; the outer Worker cannot prove their completeness.
        trace_completeness: "UNKNOWN" as const,
        service_version: serviceVersion,
        environment,
        deployment_id: deploymentId,
        attributes: {},
        expires_at: edgeSpan.expires_at,
      };
      ctx.waitUntil(recordSafely(traceId, "observability_traces", () => recordTrace(env, summary)));
      ctx.waitUntil(recordSafely(traceId, "observability_spans", () => recordSpans(env, [edgeSpan])));
    }
    const corsResponse = withCors(response, origin);
    const headers = new Headers(corsResponse.headers);
    headers.set("x-sunland-trace-id", traceId);
    return new Response(corsResponse.body, {
      status: corsResponse.status,
      statusText: corsResponse.statusText,
      headers,
    });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { url, serverKey } = supabaseServerConfig(env);
    const repository = new SupabaseRepository(url, serverKey);
    ctx.waitUntil(repository.deleteExpiredTurnResults());
  },
} satisfies ExportedHandler<Env>;

export default worker;
