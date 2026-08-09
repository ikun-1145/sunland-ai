import { describe, expect, it } from "vitest";

import { authenticate } from "../src/auth";

function base64url(value: unknown): string {
  const text = JSON.stringify(value);
  return btoa(text).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function token(payload: Record<string, unknown>, secret = "test-secret"): Promise<string> {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const body = base64url(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
  return `${header}.${body}.${encoded}`;
}

describe("application JWT authentication", () => {
  it("binds identity only from the verified token", async () => {
    const jwt = await token({ id: "user-a", email: "a@example.com", exp: Math.floor(Date.now() / 1000) + 60 });
    const user = await authenticate(new Request("https://example.test/v1/turns", {
      headers: { authorization: `Bearer ${jwt}` },
    }), "test-secret");
    expect(user).toEqual({ id: "user-a", email: "a@example.com" });
  });

  it("rejects expired and incorrectly signed tokens", async () => {
    const expired = await token({ id: "user-a", exp: Math.floor(Date.now() / 1000) - 1 });
    const wrong = await token({ id: "user-a", exp: Math.floor(Date.now() / 1000) + 60 }, "wrong");
    await expect(authenticate(new Request("https://example.test", { headers: { authorization: `Bearer ${expired}` } }), "test-secret"))
      .rejects.toMatchObject({ status: 401, code: "token_expired" });
    await expect(authenticate(new Request("https://example.test", { headers: { authorization: `Bearer ${wrong}` } }), "test-secret"))
      .rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });
});
