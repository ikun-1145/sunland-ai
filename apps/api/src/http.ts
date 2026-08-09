export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  }
  return jsonResponse(
    { error: { code: "internal_error", message: "服务暂时不可用，请稍后重试。" } },
    500,
  );
}

export async function readJson(request: Request, maximumBytes = 64 * 1024): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new HttpError(413, "payload_too_large", "请求内容过大。\n");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new HttpError(413, "payload_too_large", "请求内容过大。\n");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "请求不是有效的 JSON。\n");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function boundedText(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_request", `${field} 必须是字符串。`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new HttpError(400, "invalid_request", `${field} 长度不合法。`);
  }
  return normalized;
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
