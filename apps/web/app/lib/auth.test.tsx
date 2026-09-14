import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";
import { AUTH_USER_STORAGE_KEY, bindUserStorage, userSessionStorage } from "./userStorage";

const { apiFetch, push } = vi.hoisted(() => ({ apiFetch: vi.fn(), push: vi.fn() }));
vi.mock("./api", () => ({ apiFetch }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  apiFetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: "alice", email: "alice@example.com", is_library_public: false, is_admin: true })));
});

test("logout removes shopping, cart and planner account data while retaining device preferences", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  sessionStorage.setItem("smartShoppingList:2026-09-14", "private groceries");
  sessionStorage.setItem("smartShoppingProducts:2026-09-14:weee", "picks");
  sessionStorage.setItem("smartShoppingCart:2026-09-14:weee", "cart");
  localStorage.setItem("plannerWeekFingerprint:2026-09-14", "private plan");
  localStorage.setItem("cooking-ui-language", "zh");
  await act(async () => result.current.logout());
  expect(result.current.user).toBeNull();
  expect(sessionStorage.getItem("smartShoppingList:2026-09-14")).toBeNull();
  expect(sessionStorage.getItem("smartShoppingProducts:2026-09-14:weee")).toBeNull();
  expect(sessionStorage.getItem("smartShoppingCart:2026-09-14:weee")).toBeNull();
  expect(localStorage.getItem("plannerWeekFingerprint:2026-09-14")).toBeNull();
  expect(localStorage.getItem("cooking-ui-language")).toBe("zh");
});

test("a changed authenticated identity cannot inherit another account's shopping state", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  sessionStorage.setItem("smartShoppingList:2026-09-14", "private groceries");
  apiFetch.mockResolvedValue(new Response(JSON.stringify({ id: "bob", email: "bob@example.com", is_library_public: false })));
  await act(async () => result.current.refreshUser());
  expect(result.current.user?.id).toBe("bob");
  expect(sessionStorage.getItem("smartShoppingList:2026-09-14")).toBeNull();
});

test("auth retains the server-authorized admin role", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  expect(result.current.user).toMatchObject({ is_admin: true });
});

test("an auth refresh completing after logout cannot restore the old account", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  let resolveMe!: (response: Response) => void;
  apiFetch.mockImplementation((path: string) => path === "/auth/me"
    ? new Promise((resolve) => { resolveMe = resolve; })
    : Promise.resolve(new Response("{}")));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.refreshUser(); });
  await act(async () => { await result.current.logout(); });
  await act(async () => {
    resolveMe(new Response(JSON.stringify({ id: "alice", email: "alice@example.com" })));
    await pending;
  });
  expect(result.current.user).toBeNull();
});

test("a logout from another tab clears identity without re-authenticating with its still-in-flight cookie", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  const callsBefore = apiFetch.mock.calls.length;
  await act(async () => {
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: AUTH_USER_STORAGE_KEY, oldValue: "alice", newValue: null }));
  });
  expect(result.current.user).toBeNull();
  expect(apiFetch.mock.calls.length).toBe(callsBefore);
});

test("verifying a new tab preserves the already user-scoped cooking replay cache", async () => {
  localStorage.setItem("cookingSession:v1:alice", "pending offline actions");
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  expect(localStorage.getItem("cookingSession:v1:alice")).toBe("pending offline actions");
});

test("account binding publishes one final identity and preserves another tab's new-account cache", () => {
  bindUserStorage("alice");
  localStorage.setItem("plannerWeekFingerprint:2026-09-14:user:bob", "new plan");
  localStorage.setItem("cookingSession:v1:bob", "new cook");
  const remove = vi.spyOn(localStorage, "removeItem");
  bindUserStorage("bob");
  expect(remove).not.toHaveBeenCalledWith(AUTH_USER_STORAGE_KEY);
  expect(localStorage.getItem("plannerWeekFingerprint:2026-09-14:user:bob")).toBe("new plan");
  expect(localStorage.getItem("cookingSession:v1:bob")).toBe("new cook");
});

test("failed cache removals cannot expose another account's saved groceries", () => {
  bindUserStorage("alice");
  userSessionStorage.setItem("smartShoppingList:2026-09-14", "alice groceries");
  sessionStorage.setItem("smartShoppingList:2026-09-14", "legacy groceries");
  vi.spyOn(sessionStorage, "removeItem").mockImplementation(() => { throw new Error("Storage denied"); });
  bindUserStorage("bob");
  expect(userSessionStorage.getItem("smartShoppingList:2026-09-14")).toBeNull();
  userSessionStorage.setItem("smartShoppingList:2026-09-14", "bob groceries");
  expect(userSessionStorage.getItem("smartShoppingList:2026-09-14")).toBe("bob groceries");
});
