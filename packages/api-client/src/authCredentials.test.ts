import { afterEach, expect, test, vi } from "vitest";
import { createApiClient } from "./index";

function nativeCookieTransport(initialCookie: string | null = null) {
  let cookie = initialCookie;
  const requests: Array<{ path: string; cookie: string | null; authorization: string | null }> = [];
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    // RN XMLHttpRequest starts withCredentials=true; whatwg-fetch changes it
    // only for explicit include/omit. An unspecified credential mode keeps it.
    let withCredentials = true;
    if (init.credentials === "omit") withCredentials = false;
    const headers = new Headers(init.headers);
    const authorization = headers.get("Authorization");
    const sentCookie = withCredentials ? cookie : null;
    const path = new URL(url).pathname;
    requests.push({ path, cookie: sentCookie, authorization });

    // Cookie-backed writes require a browser Origin, while native bearer
    // writes have no Origin and must not accidentally become cookie writes.
    if (init.method === "POST" && sentCookie && !authorization && headers.get("Origin") !== "https://web.example") {
      return response({ detail: "A trusted origin is required." }, 403);
    }
    if (path === "/auth/login" || path === "/auth/register") {
      const { email } = JSON.parse(String(init.body)) as { email: string };
      const id = email.split("@")[0];
      if (withCredentials) cookie = id; // The backend also sets an auth cookie.
      return response({ id, email, is_library_public: false, access_token: `token:${id}` });
    }
    if (path === "/auth/logout") {
      if (withCredentials) cookie = null;
      return response({ ok: true });
    }
    if (path === "/auth/me") {
      const id = authorization?.replace("Bearer token:", "") ?? sentCookie;
      return id ? response({ id, email: `${id}@example.com`, is_library_public: false }) : response({ detail: "Not authenticated" }, 401);
    }
    return response([]);
  });
  vi.stubGlobal("fetch", fetcher);
  return { requests, getCookie: () => cookie };
}

afterEach(() => vi.unstubAllGlobals());

test("native login, local logout, and another login do not acquire a stale cookie", async () => {
  const transport = nativeCookieTransport();
  let token: string | null = null;
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "bearer", getToken: () => token } });
  const alice = await client.auth.login("alice@example.com", "synthetic-password");
  token = alice.access_token!;
  expect((await client.auth.me()).id).toBe("alice");

  // Native logout clears SecureStore and in-memory state, not the OS cookie jar.
  token = null;
  const bob = await client.auth.login("bob@example.com", "synthetic-password");
  expect(bob.id).toBe("bob");
  expect(transport.getCookie()).toBeNull();
  expect(transport.requests.every((request) => request.cookie === null)).toBe(true);
});

test("tokenless native registration ignores cookies retained by an older app build", async () => {
  const transport = nativeCookieTransport("previous-account");
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "bearer", getToken: () => null } });
  expect((await client.auth.register("new-account@example.com", "synthetic-password")).id).toBe("new-account");
  expect(transport.requests[0].cookie).toBeNull();
});

test("bearer requests preserve their token and omit cookies even with conflicting request options", async () => {
  const transport = nativeCookieTransport("previous-account");
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "bearer", getToken: () => "token:alice" } });
  await client.request("/recipes", { credentials: "include" });
  expect(transport.requests).toEqual([{ path: "/recipes", cookie: null, authorization: "Bearer token:alice" }]);
});

test("web cookie login, authenticated requests, logout, and another login still work", async () => {
  const transport = nativeCookieTransport();
  const client = createApiClient({
    baseUrl: "https://api.example",
    auth: { kind: "cookie" },
    defaultHeaders: { Origin: "https://web.example" },
  });
  await client.auth.login("alice@example.com", "synthetic-password");
  expect((await client.auth.me()).id).toBe("alice");
  await client.auth.logout();
  expect(transport.getCookie()).toBeNull();
  await client.auth.login("bob@example.com", "synthetic-password");
  expect((await client.auth.me()).id).toBe("bob");
  expect(transport.requests.filter((request) => request.path === "/auth/me").map((request) => request.cookie)).toEqual(["alice", "bob"]);
  expect(transport.requests.every((request) => request.authorization === null)).toBe(true);
});
