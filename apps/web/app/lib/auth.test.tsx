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

test("failed account deletion preserves identity and private data, successful deletion clears both", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  userSessionStorage.setItem("smartShoppingList:week", "private groceries");
  apiFetch.mockResolvedValueOnce(new Response("Wrong password", { status: 403 }));
  await act(async () => { await expect(result.current.deleteAccount("wrong")).rejects.toMatchObject({ status: 403 }); });
  expect(result.current.user?.id).toBe("alice");
  expect(userSessionStorage.getItem("smartShoppingList:week")).toBe("private groceries");
  apiFetch.mockResolvedValueOnce(new Response("{}"));
  await act(async () => result.current.deleteAccount("correct"));
  expect(result.current.user).toBeNull();
  expect(userSessionStorage.getItem("smartShoppingList:week")).toBeNull();
  expect(apiFetch).toHaveBeenLastCalledWith("/auth/account", { method: "DELETE", headers: { "X-Chef-World-Account-ID": "alice" }, body: JSON.stringify({ password: "correct" }) });
});

test("failed sign-out everywhere retains identity and can be retried", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  apiFetch.mockRejectedValueOnce(new Error("network"));
  await act(async () => { await expect(result.current.logoutAll()).rejects.toThrow("network"); });
  expect(result.current.user?.id).toBe("alice");
  apiFetch.mockResolvedValueOnce(new Response("{}"));
  await act(async () => result.current.logoutAll());
  expect(result.current.user).toBeNull();
});

test("a network failure during verification refresh preserves the current account", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  apiFetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await expect(result.current.refreshUser()).rejects.toThrow("offline"); });
  expect(result.current.user?.id).toBe("alice");
});

test("a failed refresh after a successful new login cannot retain the previous account", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  userSessionStorage.setItem("smartShoppingList:week", "Alice groceries");
  apiFetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await expect(result.current.refreshUser({ newSession: true })).rejects.toThrow("offline"); });
  expect(result.current.user).toBeNull();
  expect(userSessionStorage.getItem("smartShoppingList:week")).toBeNull();
  expect(result.current.loading).toBe(false);
});

test("ordinary logout reports a network failure without pretending the cookie was revoked", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  apiFetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await expect(result.current.logout()).rejects.toThrow("offline"); });
  expect(result.current.user?.id).toBe("alice");
});

test("a late account deletion response cannot clear a newer identity", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  let resolveDelete!: (response: Response) => void;
  apiFetch.mockImplementation((path: string) => path === "/auth/account"
    ? new Promise((resolve) => { resolveDelete = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ id: "bob", email: "bob@example.com" }))));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.deleteAccount("password"); });
  await act(async () => { await result.current.refreshUser(); });
  await act(async () => { resolveDelete(new Response("{}")); await pending; });
  expect(result.current.user?.id).toBe("bob");
});

test("a same-account status refresh cannot suppress successful logout", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  let resolveLogout!: (response: Response) => void;
  apiFetch.mockImplementation((path: string) => path === "/auth/logout-all"
    ? new Promise((resolve) => { resolveLogout = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ id: "alice", email: "alice@example.com" }))));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.logoutAll(); });
  await act(async () => { await result.current.refreshUser(); });
  await act(async () => { resolveLogout(new Response("{}")); await pending; });
  expect(result.current.user).toBeNull();
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

test("a failed refresh after another tab changes the cookie account cannot retain the old identity", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  userSessionStorage.setItem("smartShoppingList:week", "Alice groceries");
  apiFetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, "bob");
    window.dispatchEvent(new StorageEvent("storage", { key: AUTH_USER_STORAGE_KEY, oldValue: "alice", newValue: "bob" }));
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.user).toBeNull();
  expect(userSessionStorage.getItem("smartShoppingList:week")).toBeNull();
  expect(localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBe("bob");
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


test("auth preserves the server verification requirement without marking legacy accounts verified", async () => {
  apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: "new", email: "new@example.com", is_library_public: false, email_verification_required: true, email_verified: false })));
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("new"));
  expect(result.current.user).toMatchObject({ email_verification_required: true, email_verified: false });
  apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: "old", email: "old@example.com", is_library_public: false })));
  await act(async () => result.current.refreshUser());
  expect(result.current.user).toMatchObject({ email_verification_required: false, email_verified: false });
});


test("a captured old-account delete callback cannot send a request for the new account", async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  const staleDelete = result.current.deleteAccount;
  apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: "bob", email: "bob@example.com" })));
  await act(async () => result.current.refreshUser());
  const previous = apiFetch.mock.calls.length;
  await act(async () => { await expect(staleDelete("alice-password")).rejects.toMatchObject({ status: 409 }); });
  expect(apiFetch.mock.calls.length).toBe(previous);
  expect(result.current.user?.id).toBe("bob");
});
