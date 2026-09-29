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

function expectOriginalPreparation() {
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(screen.queryByRole("region", { name: "shopping.basicList" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /shopping\.(copyList|copied)/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Planned meals" })).toBeVisible();
}

function expectInstacartAbsent() {
  expect(screen.queryByRole("button", { name: /instacart/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /instacart/i })).not.toBeInTheDocument();
  expect(screen.queryAllByText(/instacart/i)).toHaveLength(0);
  expect(mockApiFetch.mock.calls.filter(([path]) => /instacart/i.test(path))).toHaveLength(0);
}

test("original shopping keeps smart-list preparation available without Instacart", async () => {
  render(<ShoppingListPage />);
  expect(await screen.findByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expectOriginalPreparation();
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
  expectOriginalPreparation();
  await waitFor(() => expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine")).toBe(true));
  await act(async () => pending.resolve(response({ remove: [], likely_pantry: [], purchase_items: [{ name: "Rice", suggested_purchase: "1 bag" }] })));
  expect(await screen.findByRole("button", { name: "shopping.loadPicks" })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: "Planned meals" })).not.toBeInTheDocument();
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
  expectOriginalPreparation();
  expectInstacartAbsent();
});

test.each([429, 503, 500])("refinement %s keeps a usable checklist with exact quantities and retry", async (status) => {
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/shopping-list/refine"
    ? Promise.resolve(new Response(JSON.stringify({ detail: "Unavailable" }), { status }))
    : original(path, options));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  expect(await screen.findByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).toBeEnabled();
  expect(screen.getByText("2 cups")).toBeVisible();
  expect(screen.getByText("250 ml")).toBeVisible();
  expect(screen.getByText("shopping.refineFallback")).toBeVisible();
  expect(screen.getByRole("button", { name: "shopping.retryRefine" })).toBeEnabled();
  expectInstacartAbsent();
});

test("refinement network failure preserves shopping and recovered refinement preserves checkoffs", async () => {
  const original = mockApiFetch.getMockImplementation()!;
  let refineCalls = 0;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path !== "/shopping-list/refine") return original(path, options);
    if (++refineCalls === 1) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(response({ remove: [], likely_pantry: [], purchase_items: [
      { name: "Milk", suggested_purchase: "250 ml", category: "Dairy" },
      { name: "Rice", suggested_purchase: "2 cups", category: "Pantry & Dry Goods" },
    ] }));
  });
  const view = render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "shopping.markAlreadyHave Rice" }));
  view.unmount();
  render(<ShoppingListPage />);
  expect(await screen.findByRole("checkbox", { name: "shopping.markStillNeedToBuy Rice" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "shopping.retryRefine" }));
  await waitFor(() => expect(screen.queryByText("shopping.refineFallback")).not.toBeInTheDocument());
  expect(screen.getByRole("checkbox", { name: "shopping.markStillNeedToBuy Rice" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Milk" })).not.toBeChecked();
  expect(refineCalls).toBe(2);
});

test.each([401, 403, 422])("refinement %s does not disguise an authorization or validation failure", async (status) => {
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/shopping-list/refine"
    ? Promise.resolve(new Response("{}", { status })) : original(path, options));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("shopping.refineFailed");
  expectOriginalPreparation();
});

test("unavailable optional meal preview does not block successful refinement", async () => {
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?")) return Promise.reject(new TypeError("Failed to fetch"));
    if (path === "/shopping-list/refine") return Promise.resolve(response({ remove: [], likely_pantry: [], purchase_items: [
      { name: "Rice", suggested_purchase: "2 cups" },
    ] }));
    return original(path, options);
  });
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  expect(await screen.findByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).toBeEnabled();
  expect(screen.getByText("shopping.previewUnavailable")).toBeVisible();
  expect(screen.queryByText("shopping.refineFallback")).not.toBeInTheDocument();
});

test("an unavailable meal preview keeps preparation available without showing raw groceries", async () => {
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path.startsWith("/meal-plan?")
    ? Promise.reject(new Error("Meal preview unavailable")) : original(path, options));
  render(<ShoppingListPage />);
  await screen.findByText("shopping.previewUnavailable");
  expect(screen.getByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expectOriginalPreparation();
});

test("returning to the original view hides groceries after a recovered preview", async () => {
  const original = mockApiFetch.getMockImplementation()!;
  let previewCalls = 0;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?") && ++previewCalls === 1) return Promise.reject(new Error("Offline"));
    if (path === "/shopping-list/refine") return Promise.resolve(response({ remove: [], likely_pantry: [], purchase_items: [{ name: "Rice", suggested_purchase: "1 bag" }] }));
    return original(path, options);
  });
  render(<ShoppingListPage />);
  await screen.findByText("shopping.previewUnavailable");
  fireEvent.click(screen.getByRole("button", { name: "Prepare smart shopping list" }));
  await screen.findByRole("button", { name: "shopping.backToOriginalList" });
  expect(screen.queryByText("shopping.previewUnavailable")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).toBeEnabled();
  expectInstacartAbsent();
  fireEvent.click(screen.getByRole("button", { name: "shopping.backToOriginalList" }));
  expect(screen.getByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expectOriginalPreparation();
});

test("changing weeks leaves smart grocery controls behind", async () => {
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [], purchase_items: [{ name: "Rice", suggested_purchase: "1 bag" }],
  }));
  const rendered = render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "shopping.markAlreadyHave Rice" }));
  expect(screen.getByRole("checkbox", { name: "shopping.markStillNeedToBuy Rice" })).toBeChecked();
  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-17"));
  rendered.rerender(<ShoppingListPage />);
  expect(await screen.findByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expectOriginalPreparation();
});

test("smart groceries retain checked-item filtering and clipboard failure recovery", async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard unavailable")).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [], purchase_items: [
      { name: "Rice", suggested_purchase: "1 bag" },
      { name: "Milk", suggested_purchase: "250 ml" },
    ],
  }));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "shopping.markAlreadyHave Rice" }));
  fireEvent.click(screen.getByRole("button", { name: "shopping.copyList" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("shopping.copyFailed");
  fireEvent.click(screen.getByRole("button", { name: "shopping.copyList" }));
  await screen.findByRole("button", { name: "shopping.copied" });
  expect(writeText).toHaveBeenLastCalledWith("Milk — 250 ml");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a malformed refreshed list cannot replace the current checklist", async () => {
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [], refinement_status: "fallback",
    purchase_items: [{ name: "Rice", suggested_purchase: "2 cups" }],
  }));
  const original = mockApiFetch.getMockImplementation()!;
  let listCalls = 0;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/shopping-list?") && ++listCalls > 1) return Promise.resolve(response({ error: "Bad payload" }));
    return original(path, options);
  });
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "shopping.retryRefine" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("shopping.refineFailed");
  expect(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).toBeEnabled();
  expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine")).toBe(false);
});

test("an unchanged fallback retry retains Weee product and cart progress", async () => {
  const url = "https://www.sayweee.com/product/rice";
  const token = JSON.stringify(["rice", url]);
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [], refinement_status: "fallback",
    purchase_items: rawItems.map(item => ({ name: item.name, suggested_purchase: item.total_quantity })),
  }));
  storage.setItem("smartShoppingProducts:2026-08-10:weee", JSON.stringify({
    lookup: { rice: { status: "success", products: [{ name: "Jasmine rice", price: "$4", image: "", url }], expiresAt: new Date(Date.now() + 60_000).toISOString() } },
    open: { rice: true }, queries: { rice: "Rice" },
  }));
  storage.setItem("smartShoppingCart:2026-08-10:weee", JSON.stringify({
    selectedUrlByIngredient: { rice: url }, confirmedTokens: [token],
  }));
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/shopping-list/refine"
    ? Promise.resolve(new Response("{}", { status: 429 })) : original(path, options));
  render(<ShoppingListPage />);
  await screen.findByText("Jasmine rice");
  fireEvent.click(screen.getByRole("button", { name: "shopping.retryRefine" }));
  await waitFor(() => expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine")).toBe(true));
  await waitFor(() => expect(screen.getByRole("button", { name: "shopping.retryRefine" })).toBeEnabled());
  expect(screen.getByText("Jasmine rice")).toBeVisible();
  expect(JSON.parse(storage.getItem("smartShoppingCart:2026-08-10:weee") ?? "{}").confirmedTokens).toEqual([token]);
});

test("a provider fallback response remains clearly labeled and retryable", async () => {
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/shopping-list/refine"
    ? Promise.resolve(response({ remove: [], likely_pantry: [], refinement_status: "fallback", purchase_items: [
      { name: "Rice", suggested_purchase: "2 cups", category: "Pantry & Dry Goods" },
    ] })) : original(path, options));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  expect(await screen.findByRole("button", { name: "shopping.retryRefine" })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).toBeEnabled();
});

test("refinement leaves changed quantities unchecked while preserving unchanged progress", async () => {
  storage.setItem("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [], refinement_status: "fallback",
    purchase_items: rawItems.map(item => ({ name: item.name, suggested_purchase: item.total_quantity })),
    _ui: { checked: [0, 1] },
  }));
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/shopping-list/refine"
    ? Promise.resolve(response({ remove: [], likely_pantry: [], purchase_items: [
      { name: "Rice", suggested_purchase: "3 cups" }, { name: "Milk", suggested_purchase: "250 ml" },
    ] })) : original(path, options));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "shopping.retryRefine" }));
  expect(await screen.findByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "shopping.markStillNeedToBuy Milk" })).toBeChecked();
});

test("a stalled refinement stops waiting and exposes the recipe checklist", async () => {
  const original = mockApiFetch.getMockImplementation()!;
  const timer = vi.spyOn(globalThis, "setTimeout");
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path !== "/shopping-list/refine") return original(path, options);
    return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError"))));
  });
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  await waitFor(() => expect(mockApiFetch.mock.calls.some(([path]) => path === "/shopping-list/refine")).toBe(true));
  const deadline = timer.mock.calls.find(([, delay]) => delay === 45_000)?.[0];
  expect(deadline).toBeTypeOf("function");
  await act(async () => { (deadline as () => void)(); });
  expect(await screen.findByRole("checkbox", { name: "shopping.markAlreadyHave Rice" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "shopping.retryRefine" })).toBeEnabled();
});

test.each([
  { purchase_items: [{ name: "Rice", suggested_purchase: "2 cups", category: {} }], remove: [], likely_pantry: [] },
  { purchase_items: [{ name: "Rice", suggested_purchase: "2 cups" }], remove: [{}], likely_pantry: [] },
  { purchase_items: [], remove: [], likely_pantry: [] },
  null,
])("malformed refinement output recovers without crashing or losing ingredients", async (payload) => {
  const original = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => path === "/shopping-list/refine"
    ? Promise.resolve(response(payload)) : original(path, options));
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  expect(await screen.findByRole("button", { name: "shopping.retryRefine" })).toBeEnabled();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.getByText("2 cups")).toBeVisible();
});


test("compiles original recipe contributions without counting displayed totals again", async () => {
  let submitted: unknown;
  const baseRequest = mockApiFetch.getMockImplementation()!;
  mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith("/shopping-list?")) return Promise.resolve(response([
      { name: "盐", total_quantity: "13 g; 5–10 g", source_items: [
        { name: "食用盐", quantity: "6 g" },
        { name: "盐", quantity: "7 g" },
        { name: "盐", quantity: "5–10 g" },
      ] },
    ]));
    if (path === "/shopping-list/refine") {
      submitted = JSON.parse(String(init?.body));
      return Promise.resolve(response({ remove: [], likely_pantry: [], refinement_status: "refined", purchase_items: [
        { name: "盐", suggested_purchase: "18–23 g", category: "Pantry & Dry Goods" },
      ] }));
    }
    return baseRequest(path, init);
  });
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  expect(await screen.findByText("18–23 g")).toBeVisible();
  expect(submitted).toEqual({ items: [
    { name: "食用盐", quantity: "6 g" },
    { name: "盐", quantity: "7 g" },
    { name: "盐", quantity: "5–10 g" },
  ] });
});
