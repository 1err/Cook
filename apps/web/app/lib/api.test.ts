import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { webApiClient } from "./api";
import { AUTH_USER_STORAGE_KEY, bindUserStorage, clearUserStorage, userSessionStorage } from "./userStorage";

function storage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", storage());
  vi.stubGlobal("localStorage", storage());
  window.history.replaceState({}, "", "/login");
});

afterEach(() => { clearUserStorage(); vi.unstubAllGlobals(); });

test("an old request's 401 cannot invalidate a freshly authenticated account", async () => {
  bindUserStorage("alice");
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
  const request = webApiClient.auth.me().catch((error) => error);
  bindUserStorage("bob");
  userSessionStorage.setItem("smartShoppingList:week", "Bob groceries");
  resolve(new Response(JSON.stringify({ detail: "Expired token" }), { status: 401 }));
  await request;
  expect(sessionStorage.getItem(AUTH_USER_STORAGE_KEY)).toBe("bob");
  expect(userSessionStorage.getItem("smartShoppingList:week")).toBe("Bob groceries");
});

test("a current account's 401 still clears its saved private state", async () => {
  bindUserStorage("alice");
  userSessionStorage.setItem("smartShoppingList:week", "Alice groceries");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Expired token", { status: 401 })));
  await expect(webApiClient.auth.me()).rejects.toMatchObject({ status: 401 });
  expect(sessionStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
  expect(sessionStorage.getItem("smartShoppingList:week:user:alice")).toBeNull();
});
