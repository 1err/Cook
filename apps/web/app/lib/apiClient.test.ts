import { afterEach, expect, test, vi } from "vitest";
import { ApiError, createApiClient } from "@cooking/api-client";
import { isSafeExternalUrl, safeAuthRedirect } from "@cooking/shared";

afterEach(() => vi.unstubAllGlobals());

test("authenticated API failures notify the auth boundary without consuming the error body", async () => {
  const expired = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Expired token" }), { status: 401 })));
  const api = createApiClient({ baseUrl: "https://api.example.com", auth: { kind: "bearer", getToken: () => "test-token" }, onUnauthorized: expired });
  await expect(api.auth.me()).rejects.toMatchObject({ name: "ApiError", message: "Expired token", status: 401 });
  expect(expired).toHaveBeenCalledTimes(1);
});

test("transient API failures do not invalidate an authenticated account", async () => {
  const expired = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Busy", { status: 503 })));
  const api = createApiClient({ baseUrl: "https://api.example.com", auth: { kind: "cookie" }, onUnauthorized: expired });
  await expect(api.auth.me()).rejects.toBeInstanceOf(ApiError);
  expect(expired).not.toHaveBeenCalled();
});

test("validation errors show useful messages without echoing submitted credentials", async () => {
  const syntheticPassword = "review-only-sensitive-value";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: [
    { type: "string_too_long", loc: ["body", "password"], msg: "String should have at most 1024 characters", input: syntheticPassword, ctx: { max_length: 1024 } },
  ] }), { status: 422 })));
  const api = createApiClient({ baseUrl: "https://api.example.com", auth: { kind: "bearer", getToken: () => null } });
  let failure: unknown;
  try { await api.auth.login("review@example.com", syntheticPassword); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).message).toBe("String should have at most 1024 characters");
  expect((failure as ApiError).message).not.toContain(syntheticPassword);
});

test.each(["//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example", "javascript:alert(1)"])("rejects unsafe redirect %s", (value) => {
  expect(safeAuthRedirect(value)).toBe("/library");
});

test("retains a relative application route and query", () => {
  expect(safeAuthRedirect("/shopping-list?week=2026-09-14")).toBe("/shopping-list?week=2026-09-14");
});

test.each(["javascript:alert(1)", "data:text/html,hello", "//evil.example", "https://user:pass@example.com", "https://example.com/\nrecipe", "/recipe/1"])("rejects unsafe saved external URL %s", (url) => {
  expect(isSafeExternalUrl(url)).toBe(false);
});

test.each(["https://www.youtube.com/watch?v=recipe", "http://example.com/recipe?a=1#steps"])("preserves a safe source URL %s", (url) => {
  expect(isSafeExternalUrl(url)).toBe(true);
});
