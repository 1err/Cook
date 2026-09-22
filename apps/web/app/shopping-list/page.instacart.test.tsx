import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ShoppingListPage from "./page";

const { mockApiFetch, mockUseSearchParams } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockUseSearchParams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: mockUseSearchParams,
}));
vi.mock("../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return {
    useI18n: () => ({ language: "en" }),
    useT: () => (key: string, vars?: Record<string, string | number>) => (
      ["shopping.instacartCreate", "shopping.instacartOpen", "shopping.instacartReady"].includes(key)
        ? MESSAGE_MAP.en[key] : `${key}${vars?.name ? ` ${vars.name}` : ""}`
    ),
  };
});

function response(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function storageStub() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

let storage: ReturnType<typeof storageStub>;
const rawItems = [{ name: "Rice", total_quantity: "2 cups" }, { name: "Milk", total_quantity: "250 ml" }];

beforeEach(() => {
  storage = storageStub();
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("localStorage", storageStub());
  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-10"));
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) return Promise.resolve(response(rawItems));
    if (path.startsWith("/meal-plan?") || path === "/recipes") return Promise.resolve(response([]));
    if (path === "/shopping-list/instacart") return Promise.resolve(response({ url: "https://www.instacart.com/store/shopping_lists/123" }));
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("exports original ingredients without preparing a smart list or loading Weee products", async () => {
  render(<ShoppingListPage />);
  const create = await screen.findByRole("button", { name: "Shop on Instacart" });
  expect(screen.getByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  fireEvent.click(create);

  await screen.findByRole("link", { name: "Shop on Instacart" });
  const request = mockApiFetch.mock.calls.find(([path]) => path === "/shopping-list/instacart");
  expect(JSON.parse(String(request?.[1].body))).toEqual({
    title: "shopping.title · Aug 10 — 16",
    items: [{ name: "Rice", quantity: "2 cups" }, { name: "Milk", quantity: "250 ml" }],
  });
  expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine" || path.startsWith("/store-products"))).toBe(false);
  expect(screen.getByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
});

test("exports visible unchecked smart items and preserves Weee selections and progress", async () => {
  const productUrl = "https://www.sayweee.com/product/rice";
  const confirmationToken = JSON.stringify(["rice", productUrl]);
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [],
    likely_pantry: [],
    purchase_items: [
      { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      { name: "Milk", suggested_purchase: "1 carton", category: "Dairy" },
      { name: "Kale", suggested_purchase: "1 bunch", category: "Produce" },
    ],
    _ui: { checked: [1], hidden: [2] },
  }));
  storage.setItem("smartShoppingProducts:2026-08-10:weee", JSON.stringify({
    lookup: { rice: {
      status: "success",
      products: [{ name: "Jasmine rice", price: "$4", image: "", url: productUrl }],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } },
    open: { rice: true },
    queries: { rice: "Rice" },
  }));
  storage.setItem("smartShoppingCart:2026-08-10:weee", JSON.stringify({
    selectedUrlByIngredient: { rice: productUrl },
    confirmedTokens: [confirmationToken],
  }));
  render(<ShoppingListPage />);
  const create = await screen.findByRole("button", { name: "Shop on Instacart" });
  expect(screen.getByRole("button", { name: "shopping.loadPicks" })).toBeEnabled();
  expect(await screen.findByRole("button", { name: "shopping.reviewCart" })).toBeEnabled();
  expect(screen.getByText("Jasmine rice")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "shopping.markStillNeedToBuy Milk" })).toBeChecked();
  expect(screen.queryByText("Kale")).not.toBeInTheDocument();
  const savedCart = storage.getItem("smartShoppingCart:2026-08-10:weee");
  fireEvent.click(create);

  await screen.findByRole("link", { name: "Shop on Instacart" });
  const request = mockApiFetch.mock.calls.find(([path]) => path === "/shopping-list/instacart");
  expect(JSON.parse(String(request?.[1].body)).items).toEqual([{ name: "Rice", quantity: "1 bag" }]);
  expect(screen.getByRole("button", { name: "shopping.loadPicks" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "shopping.reviewCart" })).toBeEnabled();
  expect(screen.getByText("Jasmine rice")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).not.toBeChecked();
  expect(storage.getItem("smartShoppingCart:2026-08-10:weee")).toBe(savedCart);
  expect(JSON.parse(storage.getItem("smartShoppingCart:2026-08-10:weee") ?? "{}").confirmedTokens).toEqual([confirmationToken]);

  fireEvent.click(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" }));
  expect(screen.queryByRole("link", { name: "Shop on Instacart" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeDisabled();
});

test("requires refreshing an outdated smart list before export", async () => {
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [],
    likely_pantry: [],
    purchase_items: [{ name: "Rice", suggested_purchase: "1 bag" }],
    _plannerFingerprint: "previous-plan",
  }));
  render(<ShoppingListPage />);

  expect(await screen.findByRole("button", { name: "Shop on Instacart" })).toBeDisabled();
  expect(screen.getByText("shopping.instacartRefresh")).toBeVisible();
  expect(screen.getByRole("button", { name: "shopping.refreshSmartList" })).toBeEnabled();
  expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/instacart")).toBe(false);
});

test("clears a link and disables export while smart-list preparation is running", async () => {
  const pending = deferredResponse();
  const baseRequest = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, init?: RequestInit) => path === "/shopping-list/refine" ? pending.promise : baseRequest(path, init));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Shop on Instacart" }));
  await screen.findByRole("link", { name: "Shop on Instacart" });

  fireEvent.click(screen.getByRole("button", { name: "Prepare smart shopping list" }));
  expect(screen.queryByRole("link", { name: "Shop on Instacart" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeDisabled();
  await waitFor(() => expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine")).toBe(true));
  await act(async () => pending.resolve(response({ remove: [], likely_pantry: [], purchase_items: [{ name: "Rice", suggested_purchase: "1 bag" }] })));
  expect(screen.getByRole("button", { name: "Shop on Instacart" })).toBeEnabled();
});

test("a week change cancels the old export before the destination list is shown", async () => {
  const pending = deferredResponse();
  const baseRequest = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, init?: RequestInit) => path === "/shopping-list/instacart" ? pending.promise : baseRequest(path, init));
  const { rerender } = render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Shop on Instacart" }));
  const request = mockApiFetch.mock.calls.find(([path]) => path === "/shopping-list/instacart");
  const signal = request?.[1].signal as AbortSignal;

  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-17"));
  rerender(<ShoppingListPage />);
  expect(signal.aborted).toBe(true);
  await screen.findByRole("button", { name: "Shop on Instacart" });
  await act(async () => pending.resolve(response({ url: "https://www.instacart.com/store/shopping_lists/old" })));
  expect(screen.queryByRole("link", { name: "Shop on Instacart" })).not.toBeInTheDocument();
});

test('checks and copies basic groceries during an AI failure, and exports only unchecked items', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path === '/shopping-list/refine'
    ? Promise.resolve(new Response(JSON.stringify({ detail: 'Monthly AI allowance reached' }), { status: 503 }))
    : original(path, options));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'shopping.markAlreadyHave Rice' }));
  fireEvent.click(screen.getByRole('button', { name: 'shopping.copyList' }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('Milk — 250 ml'));
  expect(mockApiFetch.mock.calls.some(([path]) => path === '/shopping-list/refine')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare smart shopping list' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('checkbox', { name: 'shopping.markStillNeedToBuy Rice' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Shop on Instacart' }));
  await screen.findByRole('link', { name: 'Shop on Instacart' });
  const request = mockApiFetch.mock.calls.find(([path]) => path === '/shopping-list/instacart');
  expect(JSON.parse(String(request?.[1].body)).items).toEqual([{ name: 'Milk', quantity: '250 ml' }]);
});

test('keeps the basic checklist usable when the optional meal preview fails', async () => {
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path.startsWith('/meal-plan?')
    ? Promise.reject(new Error('Meal preview unavailable')) : original(path, options));
  render(<ShoppingListPage />);
  expect(await screen.findByRole('checkbox', { name: 'shopping.markAlreadyHave Rice' })).toBeEnabled();
});

test('a recovered meal preview allows a newly refined list to be exported', async () => {
  const original = mockApiFetch.getMockImplementation()!;
  let previewCalls = 0;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith('/meal-plan?') && ++previewCalls === 1) return Promise.reject(new Error('Offline'));
    if (path === '/shopping-list/refine') return Promise.resolve(response({ remove: [], likely_pantry: [], purchase_items: [{ name: 'Rice', suggested_purchase: '1 bag' }] }));
    return original(path, options);
  });
  render(<ShoppingListPage />);
  await screen.findByText('shopping.previewUnavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Prepare smart shopping list' }));
  await screen.findByRole('button', { name: 'shopping.backToOriginalList' });
  expect(screen.getByRole('button', { name: 'Shop on Instacart' })).toBeEnabled();
  expect(screen.queryByText('shopping.previewUnavailable')).not.toBeInTheDocument();
});

test('does not carry basic checks into another week', async () => {
  const rendered = render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'shopping.markAlreadyHave Rice' }));
  mockUseSearchParams.mockReturnValue(new URLSearchParams('week=2026-08-17'));
  rendered.rerender(<ShoppingListPage />);
  expect(await screen.findByRole('checkbox', { name: 'shopping.markAlreadyHave Rice' })).not.toBeChecked();
});
