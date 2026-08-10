import { HttpError } from "./http";
import type { Env } from "./types";

function configured(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

export function applicationVerificationSecrets(env: Env): readonly string[] {
  const secrets = [...new Set([
    env.APP_JWT_PRIMARY_SECRET,
    env.APP_JWT_LEGACY_SECRET,
    env.APP_JWT_SECRET,
  ].filter((value): value is string => typeof value === "string" && value.length > 0))];
  if (secrets.length === 0) {
    throw new HttpError(503, "auth_unavailable", "登录验证服务暂时不可用。");
  }
  return secrets;
}

export function supabaseServerConfig(env: Env): { url: string; serverKey: string } {
  const url = configured(env.SUPABASE_PROJECT_URL, env.SUPABASE_URL);
  const serverKey = configured(env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serverKey) {
    throw new HttpError(503, "storage_unavailable", "数据服务暂时不可用。");
  }
  return { url, serverKey };
}
