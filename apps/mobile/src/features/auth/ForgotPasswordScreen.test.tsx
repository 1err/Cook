import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@cooking/api-client";
import { ForgotPasswordScreen } from "./ForgotPasswordScreen";
import { LoginScreen } from "./LoginScreen";

const mockCapabilities = jest.fn();
const mockRequestReset = jest.fn();
const mockClient = { auth: { capabilities: mockCapabilities, requestPasswordReset: mockRequestReset } };
jest.mock("../../lib/api", () => ({ buildClient: () => mockClient }));
jest.mock("../../lib/auth", () => ({ useAuth: () => ({ login: jest.fn() }) }));
jest.mock("../../lib/i18n", () => ({ useT: () => (key: string) => require("@cooking/shared").MESSAGE_MAP.en[key] ?? key }));
const props = { navigation: { goBack: jest.fn(), navigate: jest.fn() }, route: { params: { email: "person@example.com" } } } as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilities.mockResolvedValue({ password_recovery: true, email_verification: true });
  mockRequestReset.mockResolvedValue({ ok: true });
});

test("sign-in links to recovery with the entered email", async () => {
  await render(<LoginScreen {...props} />);
  await fireEvent.changeText(screen.getByLabelText("Email"), "person@example.com");
  await fireEvent.press(screen.getByRole("button", { name: "Forgot password?" }));
  expect(props.navigation.navigate).toHaveBeenCalledWith("ForgotPassword", { email: "person@example.com" });
});

test("reset uses the email web flow and keeps the response private", async () => {
  await render(<ForgotPasswordScreen {...props} />);
  expect(await screen.findByRole("button", { name: "Send reset link" })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Send reset link" }));
  expect(mockRequestReset).toHaveBeenCalledWith("person@example.com");
  expect(await screen.findByText("If an account exists for this email, a reset link will arrive shortly. Check your spam folder too.")).toBeOnTheScreen();
  expect(screen.getByText("Enter your account email. Open the link in your email to choose a new password.")).toBeOnTheScreen();
});

test("email unavailability prevents requests and offers support", async () => {
  mockCapabilities.mockResolvedValue({ password_recovery: false, email_verification: false });
  await render(<ForgotPasswordScreen {...props} />);
  expect(await screen.findByText("Account email is temporarily unavailable. Please try again later or contact support.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Send reset link" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send feedback / Get help" })).toBeOnTheScreen();
  expect(mockRequestReset).not.toHaveBeenCalled();
});

test("a pending reset cannot be sent twice and rate limits stay retryable", async () => {
  let reject!: (error: unknown) => void;
  mockRequestReset.mockImplementation(() => new Promise((_, rejectRequest) => { reject = rejectRequest; }));
  await render(<ForgotPasswordScreen {...props} />);
  const send = screen.getByRole("button", { name: "Send reset link" });
  await fireEvent.press(send);
  expect(send).toBeDisabled();
  await fireEvent.press(send);
  expect(mockRequestReset).toHaveBeenCalledTimes(1);
  await act(async () => reject(new ApiError("Slow down", 429)));
  expect(screen.getByText("Too many attempts. Please wait a few minutes before trying again.")).toBeOnTheScreen();
  expect(send).toBeEnabled();
});
