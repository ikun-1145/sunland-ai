import { describe, expect, it } from "vitest";

import { applicationVerificationSecrets, supabaseServerConfig } from "../src/config";
import type { Env } from "../src/types";

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_JWT_SECRET: "old-application-secret",
    SUPABASE_URL: "https://legacy.example",
    SUPABASE_SERVICE_ROLE_KEY: "legacy-server-key",
    CORS_ORIGINS: "https://sunland.dev",
    CORE_VERSION: "0.1.0",
    USER_BRAINS: {} as Env["USER_BRAINS"],
    ...overrides,
  };
}

describe("Worker configuration compatibility", () => {
  it("orders primary and legacy application secrets before the old alias", () => {
    expect(applicationVerificationSecrets(env({
      APP_JWT_PRIMARY_SECRET: "primary-secret",
      APP_JWT_LEGACY_SECRET: "legacy-secret",
    }))).toEqual(["primary-secret", "legacy-secret", "old-application-secret"]);
  });

  it("prefers the new Supabase aliases and retains the old fallback", () => {
    expect(supabaseServerConfig(env({
      SUPABASE_PROJECT_URL: "https://new.example",
      SUPABASE_SECRET_KEY: "new-server-key",
    }))).toEqual({ url: "https://new.example", serverKey: "new-server-key" });
    expect(supabaseServerConfig(env())).toEqual({
      url: "https://legacy.example",
      serverKey: "legacy-server-key",
    });
  });

  it("fails closed when authentication or storage credentials are absent", () => {
    expect(() => applicationVerificationSecrets(env({ APP_JWT_SECRET: "" })))
      .toThrowError(expect.objectContaining({ status: 503, code: "auth_unavailable" }));
    expect(() => supabaseServerConfig(env({
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    }))).toThrowError(expect.objectContaining({ status: 503, code: "storage_unavailable" }));
  });
});
