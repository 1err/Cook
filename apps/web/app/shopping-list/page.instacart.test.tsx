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
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectInstacartAbsent() {
  expect(screen.queryByRole("button", { name: /instacart/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /instacart/i })).not.toBeInTheDocument();
  expect(screen.queryAllByText(/instacart/i)).toHaveLength(0);
  expect(mockApiFetch.mock.calls.filter(([path]) => /instacart/i.test(path))).toHaveLength(0);
}

test("original shopping keeps smart-list preparation available without Instacart", async () => {
  render(<ShoppingListPage />);
  expect(await screen.findByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expectInstacartAbsent();
  expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine" || path.startsWith("/store-products"))).toBe(false);
});

test("smart shopping preserves Weee selections and progress without Instacart", async () => {
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
  expect(await screen.findByRole("button", { name: "shopping.loadPicks" })).toBeEnabled();
  expect(await screen.findByRole("button", { name: "shopping.reviewCart" })).toBeEnabled();
  expect(screen.getByText("Jasmine rice")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "shopping.markStillNeedToBuy Milk" })).toBeChecked();
  expect(screen.queryByText("Kale")).not.toBeInTheDocument();
  const savedCart = storage.getItem("smartShoppingCart:2026-08-10:weee");
  expectInstacartAbsent();
  fireEvent.click(screen.getByRole("button", { name: "shopping.reviewCart" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "shopping.cartClose" }));
  expect(screen.getByRole("button", { name: "shopping.loadPicks" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "shopping.reviewCart" })).toBeEnabled();
  expect(screen.getByText("Jasmine rice")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).not.toBeChecked();
  expect(storage.getItem("smartShoppingCart:2026-08-10:weee")).toBe(savedCart);
  expect(JSON.parse(storage.getItem("smartShoppingCart:2026-08-10:weee") ?? "{}").confirmedTokens).toEqual([confirmationToken]);

  fireEvent.click(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" }));
  expect(screen.getByRole("checkbox", { name: "shopping.markStillNeedToBuy Rice" })).toBeChecked();
  expectInstacartAbsent();
});

test("outdated smart shopping retains refresh without Instacart", async () => {
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [],
    likely_pantry: [],
    purchase_items: [{ name: "Rice", suggested_purchase: "1 bag" }],
    _plannerFingerprint: "previous-plan",
  }));
  render(<ShoppingListPage />);

  expect(await screen.findByRole("button", { name: "shopping.refreshSmartList" })).toBeEnabled();
  expectInstacartAbsent();
});

test("preparing a smart list never exposes Instacart or sends an export request", async () => {
  const pending = deferredResponse();
  const baseRequest = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, init?: RequestInit) => path === "/shopping-list/refine" ? pending.promise : baseRequest(path, init));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  expectInstacartAbsent();
  await waitFor(() => expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine")).toBe(true));
  await act(async () => pending.resolve(response({ remove: [], likely_pantry: [], purchase_items: [{ name: "Rice", suggested_purchase: "1 bag" }] })));
  expect(await screen.findByRole("button", { name: "shopping.loadPicks" })).toBeEnabled();
  expectInstacartAbsent();
});

test("changing weeks keeps shopping available without Instacart", async () => {
  const { rerender } = render(<ShoppingListPage />);
  await screen.findByRole("button", { name: "Prepare smart shopping list" });
  expectInstacartAbsent();

  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-17"));
  rerender(<ShoppingListPage />);
  await waitFor(() => expect(mockApiFetch.mock.calls.some(([path]) => path.startsWith("/shopping-list?") && path.includes("2026-08-17"))).toBe(true));
  expect(await screen.findByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expectInstacartAbsent();
});
