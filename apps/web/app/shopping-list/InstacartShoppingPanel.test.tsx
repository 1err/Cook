import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InstacartShoppingPanel } from "./InstacartShoppingPanel";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string) => (
    ["shopping.instacartCreate", "shopping.instacartOpen", "shopping.instacartReady"].includes(key)
      ? MESSAGE_MAP.en[key] : key
  ) };
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

const props: ComponentProps<typeof InstacartShoppingPanel> = {
  title: "Shopping list · Aug 10–16",
  listKey: "2026-08-10:original",
  items: [{ name: "Rice", quantity: "2 cups" }],
};

beforeEach(() => mockApiFetch.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("creates a link only on request and leaves external navigation to an explicit safe anchor", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  mockApiFetch.mockResolvedValue(response({ url: "https://www.instacart.com/store/shopping_lists/123" }));
  const user = userEvent.setup();
  render(<InstacartShoppingPanel {...props} />);
  expect(mockApiFetch).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Shop on Instacart" }));

  const link = await screen.findByRole("link", { name: "Shop on Instacart" });
  expect(mockApiFetch).toHaveBeenCalledWith("/shopping-list/instacart", {
    method: "POST",
    body: JSON.stringify({ title: "Shopping list · Aug 10–16", items: [{ name: "Rice", quantity: "2 cups" }] }),
    signal: expect.any(AbortSignal),
  });
  expect(screen.getByRole("status")).toHaveTextContent("Your list is ready. Tap again to review on Instacart.");
  expect(link).toHaveAttribute("href", "https://www.instacart.com/store/shopping_lists/123");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByText("shopping.instacartReview")).toBeVisible();
  expect(open).not.toHaveBeenCalled();
});

test("disables duplicate requests while a link is being created", async () => {
  const pending = deferredResponse();
  mockApiFetch.mockReturnValue(pending.promise);
  render(<InstacartShoppingPanel {...props} />);
  const button = screen.getByRole("button", { name: "Shop on Instacart" });

  fireEvent.click(button);
  fireEvent.click(button);

  expect(screen.getByRole("button", { name: "shopping.instacartCreating" })).toBeDisabled();
  expect(mockApiFetch).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(response({ url: "https://www.instacart.com/store/shopping_lists/123" })));
  expect(screen.getByRole("link", { name: "Shop on Instacart" })).toBeVisible();
});

test.each([
  ["instacart_not_configured", 503, "shopping.instacartNotConfigured"],
  ["instacart_rate_limited", 429, "shopping.instacartRateLimited"],
  ["instacart_unavailable", 502, "shopping.instacartFailed"],
  ["instacart_invalid_response", 502, "shopping.instacartFailed"],
  ["instacart_timeout", 504, "shopping.instacartFailed"],
])("shows a localized %s error without exposing server detail", async (code, status, message) => {
  mockApiFetch.mockResolvedValue(response({ detail: { code, message: "PRIVATE UPSTREAM ERROR" } }, status));
  render(<InstacartShoppingPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText("PRIVATE UPSTREAM ERROR")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeEnabled();
});

test.each([
  { url: "https://instacart.com.attacker.example/list" },
  { url: "javascript:alert(1)" },
  { url: "http://www.instacart.com/list" },
  { url: "https://user:password@www.instacart.com/list" },
  { url: 123 },
  {},
  null,
])("never renders an unsafe or malformed result %#", async (body) => {
  mockApiFetch.mockResolvedValue(response(body));
  render(<InstacartShoppingPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("shopping.instacartFailed");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("recovers from a network failure on a deliberate retry", async () => {
  mockApiFetch.mockRejectedValueOnce(new Error("Network unavailable"));
  mockApiFetch.mockResolvedValueOnce(response({ url: "https://www.instacart.com/store/shopping_lists/123" }));
  render(<InstacartShoppingPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("shopping.instacartFailed");

  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));
  expect(await screen.findByRole("link", { name: "Shop on Instacart" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test.each([
  { items: [] },
  { disabled: true },
  { stale: true },
])("prevents export of empty or outdated lists %#", (overrides) => {
  render(<InstacartShoppingPanel {...props} {...overrides} />);
  const button = screen.getByRole("button", { name: "Shop on Instacart" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(mockApiFetch).not.toHaveBeenCalled();
  expect(screen.getByText("items" in overrides ? "shopping.instacartEmpty" : "shopping.instacartRefresh")).toBeVisible();
});

test.each([
  { listKey: "2026-08-17:original" },
  { listKey: "2026-08-10:smart" },
  { items: [{ name: "Kale", quantity: "1 bunch" }] },
  { disabled: true },
  { stale: true },
])("clears an existing link when its source or readiness changes %#", async (overrides) => {
  mockApiFetch.mockResolvedValue(response({ url: "https://www.instacart.com/store/shopping_lists/123" }));
  const { rerender } = render(<InstacartShoppingPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));
  await screen.findByRole("link", { name: "Shop on Instacart" });

  rerender(<InstacartShoppingPanel {...props} {...overrides} />);

  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(mockApiFetch).toHaveBeenCalledTimes(1);
});

test("aborts a previous week's request and ignores its late result while the next request is pending", async () => {
  const previous = deferredResponse();
  const current = deferredResponse();
  mockApiFetch.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const { rerender } = render(<InstacartShoppingPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));
  const previousSignal = mockApiFetch.mock.calls[0][1].signal as AbortSignal;

  rerender(<InstacartShoppingPanel {...props} listKey="2026-08-17:original" />);
  expect(previousSignal.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));
  await act(async () => previous.resolve(response({ url: "https://www.instacart.com/store/shopping_lists/old" })));

  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "shopping.instacartCreating" })).toBeDisabled();
  await act(async () => current.resolve(response({ url: "https://www.instacart.com/store/shopping_lists/new" })));
  expect(screen.getByRole("link", { name: "Shop on Instacart" })).toHaveAttribute("href", "https://www.instacart.com/store/shopping_lists/new");
});

test("aborts a pending request on unmount even when the transport resolves later", async () => {
  const pending = deferredResponse();
  mockApiFetch.mockReturnValue(pending.promise);
  const { unmount } = render(<InstacartShoppingPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Shop on Instacart" }));
  const signal = mockApiFetch.mock.calls[0][1].signal as AbortSignal;

  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response({ url: "https://www.instacart.com/store/shopping_lists/late" })));
  await waitFor(() => expect(screen.queryByRole("link")).not.toBeInTheDocument());
});
