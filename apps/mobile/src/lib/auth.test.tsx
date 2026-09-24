import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { ApiError } from "@cooking/api-client";
import { AuthProvider, useAuth } from "./auth";
import { ephemeral } from "./storage";
import { cancelAllCookingNotifications } from "../features/cook/notifications";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../features/cook/notifications", () => ({ cancelAllCookingNotifications: jest.fn() }));
const mockMe = jest.fn();
const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockLogout = jest.fn();
const mockLogoutAll = jest.fn();
const mockDeleteAccount = jest.fn();
jest.mock("./api", () => ({ buildClient: () => ({ auth: {
  me: mockMe, login: mockLogin, register: mockRegister, logout: mockLogout,
  logoutAll: mockLogoutAll, deleteAccount: mockDeleteAccount,
} }) }));

beforeEach(() => {
  jest.resetAllMocks();
  ephemeral.clear();
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue("saved-token");
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue();
  jest.mocked(cancelAllCookingNotifications).mockResolvedValue();
  mockMe.mockResolvedValue({ id: "alice", email: "alice@example.com", is_library_public: false });
  mockLogout.mockResolvedValue({ ok: true });
  mockLogoutAll.mockResolvedValue({ ok: true });
  mockDeleteAccount.mockResolvedValue({ ok: true });
});

test.each(["login", "register"] as const)("%s retains the email verification requirement before entering the app", async (action) => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  ({ login: mockLogin, register: mockRegister })[action].mockResolvedValue({
    id: "new-account", email: "new@example.com", is_library_public: false,
    email_verified: false, email_verification_required: true, access_token: "new-token",
  });
  await act(async () => { await result.current[action]("new@example.com", "password"); });
  expect(result.current.user).toMatchObject({ email_verified: false, email_verification_required: true });
});

test("logout clears authenticated memory even when notification cleanup fails", async () => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  await ephemeral.set("smartShoppingList:week", "private groceries");
  jest.mocked(cancelAllCookingNotifications).mockRejectedValue(new Error("Notification service unavailable"));
  await act(async () => { await result.current.logout(); });
  expect(result.current.token).toBeNull();
  expect(result.current.user).toBeNull();
  expect(await ephemeral.get("smartShoppingList:week")).toBeNull();
});

test("an expired saved token is removed instead of retried on every launch", async () => {
  mockMe.mockRejectedValue(new ApiError("Expired", 401));
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.token).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});

test("a transport failure does not delete a potentially valid saved token", async () => {
  mockMe.mockRejectedValue(new TypeError("Network request failed"));
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test("a rejected old token cannot sign out a newly authenticated account", async () => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.token).toBe("saved-token"));
  mockLogin.mockResolvedValue({ id: "bob", email: "bob@example.com", is_library_public: false, access_token: "new-token" });
  await act(async () => { await result.current.login("bob@example.com", "password"); });
  await act(async () => { result.current.invalidateToken("saved-token"); });
  expect(result.current.token).toBe("new-token");
  expect(result.current.user?.id).toBe("bob");
  await act(async () => { result.current.invalidateToken("new-token"); });
  expect(result.current.token).toBeNull();
});

test("logout falls back to a blank saved credential when secure-store deletion fails", async () => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.token).toBe("saved-token"));
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValue(new Error("Deletion unavailable"));
  await act(async () => { await result.current.logout(); });
  expect(result.current.token).toBeNull();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("cooking-mobile-token", "");
});

test("a login completing after logout cannot restore the account", async () => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.token).toBe("saved-token"));
  let resolveLogin!: (value: unknown) => void;
  mockLogin.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.login("bob@example.com", "password"); });
  await act(async () => { await result.current.logout(); });
  await act(async () => {
    resolveLogin({ id: "bob", email: "bob@example.com", access_token: "new-token", is_library_public: false });
    await pending;
  });
  expect(result.current.user).toBeNull();
  expect(result.current.token).toBeNull();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith("cooking-mobile-token", "new-token");
});

test("logout keeps the account until server revocation succeeds", async () => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  let finish!: (value: { ok: boolean }) => void;
  mockLogout.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.logout(); });
  expect(result.current.user?.id).toBe("alice");
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  await act(async () => { finish({ ok: true }); await pending; });
  expect(result.current.user).toBeNull();
});

test.each(["logout", "logoutAll", "deleteAccount"] as const)("failed %s retains the account and saved credential", async (action) => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  ({ logout: mockLogout, logoutAll: mockLogoutAll, deleteAccount: mockDeleteAccount })[action]
    .mockRejectedValue(new ApiError("Rejected", action === "deleteAccount" ? 403 : 503));
  await act(async () => {
    await expect(action === "deleteAccount" ? result.current.deleteAccount("wrong password") : result.current[action]()).rejects.toThrow();
  });
  expect(result.current.user?.id).toBe("alice");
  expect(result.current.token).toBe("saved-token");
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test.each(["logout", "logoutAll", "deleteAccount"] as const)("a late %s response cannot clear a newly signed-in account", async (action) => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  let finish!: (value: { ok: boolean }) => void;
  ({ logout: mockLogout, logoutAll: mockLogoutAll, deleteAccount: mockDeleteAccount })[action]
    .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = action === "deleteAccount" ? result.current.deleteAccount("password") : result.current[action](); });
  mockLogin.mockResolvedValue({ id: "bob", email: "bob@example.com", is_library_public: false, access_token: "bob-token" });
  await act(async () => { await result.current.login("bob@example.com", "password"); });
  await act(async () => { finish({ ok: true }); await pending; });
  expect(result.current.user?.id).toBe("bob");
  expect(result.current.token).toBe("bob-token");
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test("token invalidation clears locally without trying another authenticated logout", async () => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  await act(async () => { result.current.invalidateToken("saved-token"); });
  expect(result.current.user).toBeNull();
  expect(mockLogout).not.toHaveBeenCalled();
});

test("an old verification refresh cannot replace the new account", async () => {
  const { result } = await renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.id).toBe("alice"));
  let finish!: (value: unknown) => void;
  mockMe.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  let refresh!: Promise<void>;
  await act(async () => { refresh = result.current.refreshUser(); });
  mockLogin.mockResolvedValue({ id: "bob", email: "bob@example.com", is_library_public: false, email_verified: false, access_token: "bob-token" });
  await act(async () => { await result.current.login("bob@example.com", "password"); });
  await act(async () => { finish({ id: "alice", email: "alice@example.com", is_library_public: false, email_verified: true }); await refresh; });
  expect(result.current.user?.id).toBe("bob");
  expect(result.current.user?.email_verified).toBe(false);
});
