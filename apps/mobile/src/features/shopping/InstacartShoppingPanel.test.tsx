import React from "react";
import { Linking } from "react-native";
import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { ApiError } from "@cooking/api-client";
import { InstacartShoppingPanel } from "./InstacartShoppingPanel";

const mockCreateLink = jest.fn();
const mockApiClient = { shopping: { createInstacartLink: mockCreateLink } };

jest.mock("../../lib/api", () => ({ useApiClient: () => mockApiClient }));
jest.mock("../../lib/i18n", () => {
  const { MESSAGE_MAP } = require("@cooking/shared");
  return { useT: () => (key: string) => (
    ["shopping.instacartCreate", "shopping.instacartOpen", "shopping.instacartReady"].includes(key)
      ? MESSAGE_MAP.en[key] : key
  ) };
});

const SAFE_URL = "https://www.instacart.com/store/shopping_lists/123";
const ITEMS = [{ name: "Rice", quantity: "1 bag" }, { name: "Kale", quantity: "2 bunches" }];
const defaultProps = { items: ITEMS, listKey: "2026-09-14:original", disabled: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateLink.mockReset().mockResolvedValue({ url: SAFE_URL });
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

test("creates the current ingredient link only on press and waits for a separate open action", async () => {
  await render(<InstacartShoppingPanel {...defaultProps} />);
  expect(mockCreateLink).not.toHaveBeenCalled();
  const user = userEvent.setup();

  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(mockCreateLink).toHaveBeenCalledWith(
    { title: "shopping.instacartTitle", items: ITEMS },
    { signal: expect.any(AbortSignal) },
  );
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(screen.getByText("Your list is ready. Tap again to review on Instacart.")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(Linking.openURL).toHaveBeenCalledWith(SAFE_URL);
  expect(mockCreateLink).toHaveBeenCalledTimes(1);
  expect(screen.getByText("shopping.instacartReview")).toBeOnTheScreen();
});

test("blocks duplicate create presses while the link request is pending", async () => {
  const pending = deferred<{ url: string }>();
  mockCreateLink.mockReturnValue(pending.promise);
  await render(<InstacartShoppingPanel {...defaultProps} />);
  const button = screen.getByRole("button", { name: "Shop on Instacart" });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(mockCreateLink).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "shopping.instacartCreating" })).toBeDisabled();
  await act(async () => pending.resolve({ url: SAFE_URL }));
  expect(screen.getByText("Your list is ready. Tap again to review on Instacart.")).toBeOnTheScreen();
});

test.each([
  { items: [], disabled: false, hint: "shopping.instacartEmpty" },
  { items: ITEMS, disabled: true, hint: "shopping.instacartRefresh" },
])("prevents export and explains $hint", async ({ items, disabled, hint }) => {
  await render(<InstacartShoppingPanel {...defaultProps} items={items} disabled={disabled} />);
  const button = screen.getByRole("button", { name: "Shop on Instacart" });
  expect(button).toBeDisabled();
  expect(screen.getByText(hint)).toBeOnTheScreen();
  await fireEvent.press(button);
  expect(mockCreateLink).not.toHaveBeenCalled();
});

test.each([
  ["instacart_not_configured", "shopping.instacartNotConfigured"],
  ["instacart_rate_limited", "shopping.instacartRateLimited"],
  ["instacart_unavailable", "shopping.instacartFailed"],
  ["instacart_invalid_response", "shopping.instacartFailed"],
  ["instacart_timeout", "shopping.instacartFailed"],
])("shows a safe actionable error for %s and allows retry", async (code, expectedMessage) => {
  mockCreateLink.mockRejectedValueOnce(new ApiError("Private upstream response", 503, code));
  await render(<InstacartShoppingPanel {...defaultProps} />);
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));

  expect(screen.getByText(expectedMessage)).toBeOnTheScreen();
  expect(screen.queryByText("Private upstream response")).not.toBeOnTheScreen();
  expect(screen.queryByText("Your list is ready. Tap again to review on Instacart.")).not.toBeOnTheScreen();
  expect(Linking.openURL).not.toHaveBeenCalled();
  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(screen.getByText("Your list is ready. Tap again to review on Instacart.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeEnabled();
});

test.each([
  "https://www.instacart.com.evil.test/list/123",
  "http://www.instacart.com/list/123",
  "javascript:alert(1)",
])("rejects an unsafe returned link: %s", async (url) => {
  mockCreateLink.mockResolvedValue({ url });
  await render(<InstacartShoppingPanel {...defaultProps} />);
  await userEvent.setup().press(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(screen.getByText("shopping.instacartFailed")).toBeOnTheScreen();
  expect(screen.queryByText("Your list is ready. Tap again to review on Instacart.")).not.toBeOnTheScreen();
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test.each([
  { listKey: "2026-09-21:original" },
  { listKey: "2026-09-14:smart" },
  { items: [{ name: "Beans", quantity: "2 cans" }] },
  { disabled: true },
])("clears a generated link when list context changes: %j", async (changes) => {
  const rendered = await render(<InstacartShoppingPanel {...defaultProps} />);
  await userEvent.setup().press(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(screen.getByText("Your list is ready. Tap again to review on Instacart.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeEnabled();
  await rendered.rerender(<InstacartShoppingPanel {...defaultProps} {...changes} />);
  expect(screen.queryByText("Your list is ready. Tap again to review on Instacart.")).not.toBeOnTheScreen();
});

test("aborts and ignores an old response after changing lists, even after returning to the original list", async () => {
  const oldResponse = deferred<{ url: string }>();
  mockCreateLink.mockReturnValueOnce(oldResponse.promise);
  const rendered = await render(<InstacartShoppingPanel {...defaultProps} />);
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));
  const oldSignal = mockCreateLink.mock.calls[0][1].signal as AbortSignal;

  await rendered.rerender(<InstacartShoppingPanel {...defaultProps} listKey="next-week" />);
  expect(oldSignal.aborted).toBe(true);
  await rendered.rerender(<InstacartShoppingPanel {...defaultProps} />);
  await act(async () => oldResponse.resolve({ url: SAFE_URL }));
  expect(screen.queryByText("Your list is ready. Tap again to review on Instacart.")).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeEnabled();
});

test("cancels a pending request when unmounted", async () => {
  const pending = deferred<{ url: string }>();
  mockCreateLink.mockReturnValueOnce(pending.promise);
  const rendered = await render(<InstacartShoppingPanel {...defaultProps} />);
  await userEvent.setup().press(screen.getByRole("button", { name: "Shop on Instacart" }));
  const signal = mockCreateLink.mock.calls[0][1].signal as AbortSignal;
  await rendered.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ url: SAFE_URL }));
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test("retains the generated link and reports an open failure so the user can retry", async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("Cannot open URL"));
  await render(<InstacartShoppingPanel {...defaultProps} />);
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));
  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(screen.getByText("shopping.instacartOpenFailed")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeEnabled();
  await user.press(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
  expect(mockCreateLink).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("shopping.instacartOpenFailed")).not.toBeOnTheScreen();
});
