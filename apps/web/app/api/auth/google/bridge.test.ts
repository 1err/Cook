// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as prepare } from "./prepare/route";
import { POST as callback } from "./callback/route";
import { POST as resume } from "./resume/route";
import { POST as clear } from "./clear/route";

const origin = "https://chef-world.com";
const contextName = "cw_google_redirect_context";
const credentialName = "cw_google_redirect_credential";
const cookiePath = "/api/auth/google";
const csrf = "opaque-google-csrf-proof";
const credential = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.c2lnbmF0dXJl";
const accountId = "b6ad3e09-9f2a-4123-908d-4f8107fd9356";

function request(path: string, options: { body?: string; cookies?: Record<string, string>; origin?: string | null; contentType?: string; host?: string } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("Origin", options.origin || origin);
  if (options.contentType) headers.set("Content-Type", options.contentType);
  if (options.cookies) headers.set("Cookie", Object.entries(options.cookies).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; "));
  return new NextRequest(`${options.host || origin}${cookiePath}/${path}`, { method: "POST", headers, body: options.body });
}

async function prepared(body: Record<string, unknown> = { return_path: "/login", redirect: "/library" }) {
  const response = await prepare(request("prepare", { body: JSON.stringify(body), contentType: "application/json" }));
  expect(response.status).toBe(200);
  return response.cookies.get(contextName)!.value;
}

function googleCallback(context: string | undefined, token = credential, bodyCsrf = csrf, cookieCsrf: string | undefined = csrf) {
  return request("callback", {
    origin: "https://accounts.google.com",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ credential: token, g_csrf_token: bodyCsrf }).toString(),
    cookies: { ...(context ? { [contextName]: context } : {}), ...(cookieCsrf ? { g_csrf_token: cookieCsrf } : {}) },
  });
}

async function pending(body?: Record<string, unknown>) {
  const response = await callback(googleCallback(await prepared(body)));
  expect(response.status).toBe(303);
  return { response, cookie: response.cookies.get(credentialName)!.value };
}

function noStore(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T20:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Google redirect preparation", () => {
  it("stores a short-lived host-only context and clears older pending credentials", async () => {
    const response = await prepare(request("prepare", { body: JSON.stringify({ return_path: "/register", redirect: "/planner?week=next" }), contentType: "application/json" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const context = response.cookies.get(contextName)!;
    expect(context).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", path: cookiePath, maxAge: 600 });
    expect(context.domain).toBeUndefined();
    expect(response.cookies.get(credentialName)?.maxAge).toBe(0);
    expect(context.value).not.toContain(credential);
    noStore(response);
  });

  it.each([null, "null", "https://evil.example", "https://www.chef-world.com"])("rejects a nonmatching prepare Origin %s", async (requestOrigin) => {
    const response = await prepare(request("prepare", { origin: requestOrigin, body: JSON.stringify({ return_path: "/login" }), contentType: "application/json" }));
    expect(response.status).toBe(403);
    expect(response.cookies.get(contextName)).toBeUndefined();
    noStore(response);
  });

  it.each(["//evil.example", "https://evil.example", "/unknown", "/settings?delete=1"])("rejects non-whitelisted return path %s", async (return_path) => {
    const response = await prepare(request("prepare", { body: JSON.stringify({ return_path }), contentType: "application/json" }));
    expect(response.status).toBe(400);
    noStore(response);
  });

  it("requires the original account UUID for a settings continuation", async () => {
    for (const value of [undefined, "not-an-account-id"]) {
      const response = await prepare(request("prepare", { body: JSON.stringify({ return_path: "/settings", expected_account_id: value }), contentType: "application/json" }));
      expect(response.status).toBe(400);
    }
    await prepared({ return_path: "/settings", expected_account_id: accountId });
  });

  it("rejects a forged host instead of reflecting it into a callback Location", async () => {
    const response = await prepare(request("prepare", { host: "https://evil.example", origin: "https://evil.example", body: JSON.stringify({ return_path: "/login" }), contentType: "application/json" }));
    expect(response.status).toBe(403);
  });

  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "/%5cevil.example", "/%2f%2fevil.example", "/\nunsafe"])("keeps unsafe post-login destination %s on the app", async (redirect) => {
    const { response } = await pending({ return_path: "/login", redirect });
    const target = new URL(response.headers.get("location")!, origin);
    expect(target.origin).toBe(origin);
    expect(target.searchParams.get("redirect")).toBe("/library");
  });
});

describe("Google redirect callback", () => {
  it("returns to a safe app path while keeping the credential only in a bounded HttpOnly cookie", async () => {
    const { response } = await pending({ return_path: "/register", redirect: "/import?share=abc" });
    const target = new URL(response.headers.get("location")!, origin);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/register");
    expect(target.searchParams.get("google_resume")).toBe("1");
    expect(target.searchParams.get("redirect")).toBe("/import?share=abc");
    expect(target.toString()).not.toContain(credential);
    expect(await response.text()).not.toContain(credential);
    const proof = response.cookies.get(credentialName)!;
    expect(proof).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: cookiePath, maxAge: 600 });
    expect(proof.domain).toBeUndefined();
    expect(encodeURIComponent(proof.value).length).toBeLessThanOrEqual(3500);
    expect(response.cookies.get(contextName)?.maxAge).toBe(0);
    expect(response.cookies.get("access_token")).toBeUndefined();
    expect(response.cookies.get("google_auth_challenge")).toBeUndefined();
    noStore(response);
  });

  it.each(["missing-cookie", "missing-body", "mismatch", "duplicate"])("rejects Google CSRF %s and removes stale proof", async (kind) => {
    const context = await prepared();
    const body = new URLSearchParams({ credential, g_csrf_token: kind === "mismatch" ? "other-proof" : csrf });
    if (kind === "missing-body") body.delete("g_csrf_token");
    if (kind === "duplicate") body.append("g_csrf_token", csrf);
    const response = await callback(request("callback", { origin: "https://accounts.google.com", contentType: "application/x-www-form-urlencoded", body: body.toString(), cookies: { [contextName]: context, [credentialName]: "stale-private-proof", ...(kind === "missing-cookie" ? {} : { g_csrf_token: csrf }) } }));
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!, origin);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("google_error")).toBe("1");
    expect(response.cookies.get(credentialName)?.maxAge).toBe(0);
    expect(response.cookies.get(contextName)?.maxAge).toBe(0);
    noStore(response);
  });

  it("rejects missing or expired context rather than accepting unsolicited credentials", async () => {
    const context = await prepared();
    vi.advanceTimersByTime(601000);
    for (const value of [undefined, context]) {
      const response = await callback(googleCallback(value));
      expect(response.status).toBe(303);
      expect(new URL(response.headers.get("location")!, origin).searchParams.get("google_error")).toBe("1");
      expect(response.cookies.get(credentialName)?.maxAge).toBe(0);
    }
  });

  it.each(["not-a-jwt", `header.payload.${"s".repeat(3700)}`])("fails gracefully for invalid or oversized credential without leaking it", async (token) => {
    const response = await callback(googleCallback(await prepared(), token));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("google_error=1");
    expect(response.headers.get("location")).not.toContain(token);
    expect(await response.text()).not.toContain(token);
    expect(response.cookies.get(credentialName)?.maxAge).toBe(0);
  });

  it("bounds the complete form body before parsing", async () => {
    const context = await prepared();
    const body = new URLSearchParams({ credential, g_csrf_token: csrf, unrelated: "x".repeat(10000) }).toString();
    const response = await callback(request("callback", { contentType: "application/x-www-form-urlencoded", body, cookies: { [contextName]: context, g_csrf_token: csrf } }));
    expect(response.status).toBe(303);
    expect(response.cookies.get(credentialName)?.maxAge).toBe(0);
    expect(response.headers.get("location")).toContain("google_error=1");
  });

  it("does not trust a forged return path in a context cookie", async () => {
    const value = JSON.stringify({ return_path: "https://evil.example", redirect: "//evil.example", expires_at: Date.now() + 600000 });
    const response = await callback(googleCallback(value));
    const target = new URL(response.headers.get("location")!, origin);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("google_error")).toBe("1");
  });
});

describe("Google redirect resume and cleanup", () => {
  it("returns the same credential on repeated same-origin POSTs without consuming it", async () => {
    const { cookie } = await pending();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await resume(request("resume", { cookies: { [credentialName]: cookie } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ credential });
      expect(response.headers.get("set-cookie")).toBeNull();
      noStore(response);
    }
  });

  it("keeps the captured account ID available for deletion scope validation", async () => {
    const { response, cookie } = await pending({ return_path: "/settings", expected_account_id: accountId });
    expect(new URL(response.headers.get("location")!, origin).pathname).toBe("/settings");
    const resumed = await resume(request("resume", { cookies: { [credentialName]: cookie } }));
    expect(await resumed.json()).toEqual({ credential, expected_account_id: accountId });
  });

  it.each([null, "null", "https://evil.example", "https://www.chef-world.com"])("never exposes the credential to Origin %s", async (requestOrigin) => {
    const { cookie } = await pending();
    const response = await resume(request("resume", { origin: requestOrigin, cookies: { [credentialName]: cookie } }));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(credential);
    noStore(response);
  });

  it("returns401 when the pending cookie is missing or expired", async () => {
    const { cookie } = await pending();
    vi.advanceTimersByTime(601000);
    const variants: Array<Record<string, string>> = [{}, { [credentialName]: cookie }];
    for (const cookies of variants) {
      const response = await resume(request("resume", { cookies }));
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(credential);
      noStore(response);
    }
  });

  it("only clears browser bridge state on a same-origin request", async () => {
    const denied = await clear(request("clear", { origin: "https://evil.example" }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("set-cookie")).toBeNull();
    const response = await clear(request("clear"));
    expect(await response.json()).toEqual({ ok: true });
    expect(response.cookies.get(credentialName)?.maxAge).toBe(0);
    expect(response.cookies.get(contextName)?.maxAge).toBe(0);
    expect(response.cookies.get("google_auth_challenge")).toBeUndefined();
    expect(response.cookies.get("access_token")).toBeUndefined();
    noStore(response);
  });
});
