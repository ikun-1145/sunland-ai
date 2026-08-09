import { HttpError } from "./http";
import type { AuthenticatedUser } from "./types";

interface JwtPayload {
  id?: unknown;
  email?: unknown;
  exp?: unknown;
  iss?: unknown;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new HttpError(401, "invalid_token", "登录凭证无效。\n");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parsePayload(segment: string): JwtPayload {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment))) as JwtPayload;
  } catch {
    throw new HttpError(401, "invalid_token", "登录凭证无效。\n");
  }
}

export async function authenticate(
  request: Request,
  secret: string,
  expectedIssuer?: string,
): Promise<AuthenticatedUser> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/iu.exec(authorization);
  if (!match?.[1]) throw new HttpError(401, "missing_token", "请先登录。\n");

  const parts = match[1].split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new HttpError(401, "invalid_token", "登录凭证无效。\n");
  }
  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as typeof header;
  } catch {
    throw new HttpError(401, "invalid_token", "登录凭证无效。\n");
  }
  if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
    throw new HttpError(401, "invalid_token", "登录凭证算法不受支持。\n");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new HttpError(401, "invalid_token", "登录凭证无效。\n");

  const payload = parsePayload(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp <= now) {
    throw new HttpError(401, "token_expired", "登录已过期，请重新登录。\n");
  }
  if (expectedIssuer && payload.iss !== undefined && payload.iss !== expectedIssuer) {
    throw new HttpError(401, "invalid_token", "登录凭证签发方无效。\n");
  }
  if (typeof payload.id !== "string" || payload.id.length < 1 || payload.id.length > 128) {
    throw new HttpError(401, "invalid_token", "登录凭证缺少用户身份。\n");
  }

  return {
    id: payload.id,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
  };
}
