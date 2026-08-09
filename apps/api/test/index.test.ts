import { describe, expect, it } from "vitest";

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
});
