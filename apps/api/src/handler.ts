import { authenticate } from "./auth";
import { applicationVerificationSecrets, supabaseServerConfig } from "./config";
import { errorResponse, HttpError, jsonResponse } from "./http";
import { SupabaseRepository } from "./supabaseRepository";
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
  headers.set("access-control-expose-headers", "retry-after");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handle(request: Request, env: Env): Promise<Response> {
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
        "access-control-allow-headers": "authorization,content-type",
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
  headers.set("x-sunland-user-id", user.id);
  return await stub.fetch(new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  }));
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    try {
      return withCors(await handle(request, env), origin);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error("unhandled_request_error");
      return withCors(errorResponse(error), origin);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { url, serverKey } = supabaseServerConfig(env);
    const repository = new SupabaseRepository(url, serverKey);
    ctx.waitUntil(repository.deleteExpiredTurnResults());
  },
} satisfies ExportedHandler<Env>;

export default worker;
