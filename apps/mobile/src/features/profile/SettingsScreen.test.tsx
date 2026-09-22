import React from "react";
import { Alert, Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ApiError } from "@cooking/api-client";
import { SettingsScreen } from "./SettingsScreen";

const mockLogout = jest.fn();
const mockLogoutAll = jest.fn();
const mockDeleteAccount = jest.fn();
const mockRefreshUser = jest.fn();
const mockCapabilities = jest.fn();
const mockVerify = jest.fn();
let mockUser = { id: "alice", email: "alice@example.com", is_library_public: false, email_verified: false };
const mockClient = { auth: { capabilities: mockCapabilities, requestEmailVerification: mockVerify } };
jest.mock("../../lib/auth", () => ({ useAuth: () => ({
  user: mockUser, logout: mockLogout, logoutAll: mockLogoutAll,
  deleteAccount: mockDeleteAccount, refreshUser: mockRefreshUser,
}) }));
jest.mock("../../lib/api", () => ({ useApiClient: () => mockClient }));
jest.mock("../../lib/i18n", () => ({ useT: () => (key: string) => require("@cooking/shared").MESSAGE_MAP.en[key] ?? key }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "alice", email: "alice@example.com", is_library_public: false, email_verified: false };
  mockCapabilities.mockResolvedValue({ password_recovery: true, email_verification: true });
  mockVerify.mockResolvedValue({ ok: true });
  mockLogout.mockResolvedValue(undefined);
  mockLogoutAll.mockResolvedValue(undefined);
  mockDeleteAccount.mockResolvedValue(undefined);
  mockRefreshUser.mockResolvedValue(undefined);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

async function confirmAlert() {
  const actions = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => { await actions?.find((action) => action.style === "destructive")?.onPress?.(); });
}

test("deletion needs a password and explicit confirmation, and a wrong password preserves the account", async () => {
  mockDeleteAccount.mockRejectedValue(new ApiError("Incorrect password", 403));
  await render(<SettingsScreen />);
  const remove = screen.getByRole("button", { name: "Delete account permanently" });
  expect(remove).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Current password"), "incorrect-password");
  expect(remove).toBeDisabled();
  await fireEvent(screen.getByRole("checkbox", { name: "I understand that account deletion is permanent." }), "press");
  await fireEvent.press(remove);
  expect(mockDeleteAccount).not.toHaveBeenCalled();
  await confirmAlert();
  expect(mockDeleteAccount).toHaveBeenCalledWith("incorrect-password");
  expect(screen.getByText("The password is incorrect. Your account has not been deleted.")).toBeOnTheScreen();
  expect(screen.getByText("alice@example.com")).toBeOnTheScreen();
  expect(mockLogout).not.toHaveBeenCalled();
});

test("failed global sign-out gives a retryable error and keeps settings usable", async () => {
  mockLogoutAll.mockRejectedValue(new TypeError("Network request failed"));
  await render(<SettingsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Sign out everywhere" }));
  await confirmAlert();
  expect(screen.getByText("Could not confirm sign-out on the server. Please reconnect and try again.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeEnabled();
  expect(screen.getByText("alice@example.com")).toBeOnTheScreen();
});

test("verification can be requested and its status refreshed", async () => {
  const view = await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Verify email" })).toBeEnabled());
  await fireEvent.press(screen.getByRole("button", { name: "Verify email" }));
  expect(await screen.findByText("A verification link has been requested. Check your email.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Check verification status" }));
  expect(mockRefreshUser).toHaveBeenCalledTimes(1);
  mockUser = { ...mockUser, email_verified: true };
  await view.rerender(<SettingsScreen />);
  expect(screen.getByText("Email verified")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Verify email" })).toBeNull();
});

test("unconfigured email stays unavailable and support links use published destinations", async () => {
  mockCapabilities.mockResolvedValue({ password_recovery: false, email_verification: false });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await render(<SettingsScreen />);
  expect(await screen.findByText("Account email is temporarily unavailable. Please try again later or contact support.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Verify email" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Send feedback / Get help" }));
  expect(open).toHaveBeenLastCalledWith("mailto:jerryxiang24@gmail.com?subject=Chef%20World%20beta%20feedback");
  await fireEvent.press(screen.getByRole("button", { name: "Privacy notice" }));
  expect(open).toHaveBeenLastCalledWith("https://chef-world.com/privacy");
});


test("ordinary sign-out also reports a failed server revocation", async () => {
  mockLogout.mockRejectedValue(new TypeError("Offline"));
  await render(<SettingsScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  await confirmAlert();
  expect(mockLogout).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Could not confirm sign-out on the server. Please reconnect and try again.")).toBeOnTheScreen();
  expect(screen.getByText("alice@example.com")).toBeOnTheScreen();
});

test("checking verification retries email availability after a network failure", async () => {
  mockCapabilities.mockRejectedValueOnce(new TypeError("Offline"));
  await render(<SettingsScreen />);
  expect(await screen.findByText("Account email is temporarily unavailable. Please try again later or contact support.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Verify email" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Check verification status" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Verify email" })).toBeEnabled());
  expect(mockCapabilities).toHaveBeenCalledTimes(2);
  expect(mockRefreshUser).toHaveBeenCalledTimes(1);
});
