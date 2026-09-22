import { afterEach, expect, test, vi } from "vitest";
import { createApiClient } from "./index";

afterEach(() => vi.unstubAllGlobals());

test("recovery keeps the secret token in a JSON body and sends no password in the URL", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ ok: true }));
  });
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "cookie" } });
  await client.auth.confirmPasswordReset("secret-reset-token", "new-password-123");
  expect(requests[0].url).toBe("https://api.example/auth/password-reset/confirm");
  expect(requests[0].init.method).toBe("POST");
  expect(JSON.parse(String(requests[0].init.body))).toEqual({ token: "secret-reset-token", password: "new-password-123" });
  expect(requests[0].init.credentials).toBe("include");
});

test("wrong deletion password is recoverable without expiring the signed-in session", async () => {
  const expired = vi.fn();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer session-token");
    expect(JSON.parse(String(init.body))).toEqual({ password: "wrong-password" });
    return new Response(JSON.stringify({ detail: "Password is incorrect" }), { status: 403 });
  });
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "bearer", getToken: () => "session-token" }, onUnauthorized: expired });
  await expect(client.auth.deleteAccount("wrong-password")).rejects.toMatchObject({ status: 403 });
  expect(expired).not.toHaveBeenCalled();
});
