import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ShoppingListPage from "./page";
import { bindUserStorage, clearUserStorage } from "../lib/userStorage";

const { mockApiFetch, mockUseRouter, mockUseSearchParams } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockUseRouter: vi.fn(),
  mockUseSearchParams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: mockUseRouter,
  useSearchParams: mockUseSearchParams,
}));

vi.mock("../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../lib/i18n", () => ({
  useI18n: () => ({ language: "en" }),
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "common.loading": "Loading...",
      "shopping.viewProducts": "View products",
      "shopping.hideProducts": "Hide products",
      "shopping.waitingProducts": "Waiting to load from Weee…",
      "shopping.findingProducts": "Finding matches on Weee…",
      "shopping.productLoadFailed": "Could not load products from Weee.",
      "shopping.noProductsFound": "No products found on {store}",
      "shopping.retryProducts": "Retry",
      "shopping.seeListing": "See listing",
      "shopping.viewOnStore": "View on {store}",
      "shopping.smartMode": "Smart mode",
      "shopping.backToOriginalList": "Back to original list",
      "shopping.copyList": "Copy list",
      "shopping.copied": "Copied!",
      "shopping.loadPicks": "Load top picks from {store}",
      "shopping.loadingPicks": "Loading picks from {store}…",
      "shopping.loadingMatches": "Loading store matches… {current} of {total}",
      "shopping.reviewCart": "Review Weee cart ({count})",
      "shopping.cartEyebrow": "Weee cart companion",
      "shopping.cartTitle": "Review Weee cart",
      "shopping.cartClose": "Close Weee cart review",
      "shopping.cartSummaryLabel": "Cart draft summary",
      "shopping.cartReadyCount": "{count} ready",
      "shopping.cartUnmatchedCount": "{count} unmatched",
      "shopping.cartPendingCountOne": "1 finding a match",
      "shopping.cartPendingCountMany": "{count} finding matches",
      "shopping.cartConfirmedCount": "{count} marked as added",
      "shopping.cartEstimate": "Estimated subtotal: {amount}",
      "shopping.cartUnpricedOne": "1 selected item has no price in the listing estimate.",
      "shopping.cartUnpricedMany": "{count} selected items have no price in the listing estimate.",
      "shopping.cartNext": "Next: {name}",
      "shopping.cartCurrentDetail": "You need {amount}. Selected: {product}.",
      "shopping.cartOpenNext": "Open next on Weee",
      "shopping.cartOpenAgain": "Open again",
      "shopping.cartDirectLink": "Open {name} directly on Weee",
      "shopping.cartConfirm": "I added it",
      "shopping.cartSkip": "Skip for now",
      "shopping.cartUndo": "Undo",
      "shopping.cartUndoItem": "Undo {name}",
      "shopping.cartSkipped": "Skipped this review",
      "shopping.cartReviewPassComplete": "Review pass complete",
      "shopping.cartHandoffComplete": "Handoff complete",
      "shopping.cartFinalReviewDetail": "Review price, availability, quantities, and your final cart directly on Weee.",
      "shopping.cartFinalReview": "Open Weee for final review",
      "shopping.cartUnmatchedTitle": "Needs a match",
      "shopping.cartPendingTitle": "Finding matches",
      "shopping.cartFindMatch": "Find match",
      "shopping.cartFindMatchItem": "Find a match for {name}",
      "shopping.cartTrust": "Price and availability are confirmed on Weee. Chef World has not changed your Weee cart; an item is marked only when you say you added it.",
      "shopping.cartChoiceGroup": "Choose {name} for cart",
      "shopping.cartChoiceGroupGeneric": "Choose a product for cart",
      "shopping.cartTopPick": "Top pick",
      "shopping.cartSelected": "Selected for cart",
      "shopping.cartSelectedProduct": "{name}: Selected for cart",
      "shopping.cartChooseProduct": "Choose {name} for cart",
      "shopping.cartChoose": "Choose for cart",
    };
    return (messages[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => String(vars?.[name] ?? ""),
    );
  },
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function productResponse(
  products: unknown[],
  expiresAt = new Date(Date.now() + 86_400_000).toISOString(),
) {
  return jsonResponse({
    products,
    expires_at: products.length ? expiresAt : null,
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nearFutureExpiry() {
  return new Date(Date.now() + 60_000).toISOString();
}

function stubSessionStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

function stubThrowingSessionStorage(values: Map<string, string>) {
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: () => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    },
    removeItem: (key: string) => values.delete(key),
  });
}

function stubRemoveThrowingSessionStorage(values: Map<string, string>) {
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: () => {
      throw new DOMException("Storage access denied", "SecurityError");
    },
  });
}

function stubUnavailableSessionStorage(values: Map<string, string>) {
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: () => {
      throw new DOMException("Storage write denied", "SecurityError");
    },
    removeItem: () => {
      throw new DOMException("Storage remove denied", "SecurityError");
    },
  });
}

beforeEach(() => {
  mockUseRouter.mockReturnValue({ push: vi.fn() });
  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-10"));
});

afterEach(() => {
  cleanup();
  clearUserStorage();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test.each([undefined, 1])("offers to refresh legacy quantities without discarding shopping progress (version %s)", async (version) => {
  const storage = stubSessionStorage();
  storage.set("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [],
    purchase_items: [{ name: "盐", suggested_purchase: "4 /8小勺", category: "Other" }],
    _quantityVersion: version,
    _ui: { hidden: [], checked: [0] },
  }));
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) return Promise.resolve(jsonResponse([{ name: "盐", total_quantity: "0.5 小勺" }]));
    if (path.startsWith("/meal-plan?") || path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/shopping-list/refine") return Promise.resolve(jsonResponse({
      remove: [], likely_pantry: [],
      purchase_items: [{ name: "盐", suggested_purchase: "0.5 小勺", category: "Pantry & Dry Goods" }],
    }));
    throw new Error(`Unexpected request: ${path}`);
  });
  const view = render(<ShoppingListPage />);
  expect(await screen.findByRole("checkbox")).toBeChecked();
  expect(await screen.findByRole("button", { name: "shopping.refreshSmartList" })).toBeVisible();
  // Reading and persisting an old list must not silently mark its totals as fixed.
  view.unmount();
  render(<ShoppingListPage />);
  const refresh = await screen.findByRole("button", { name: "shopping.refreshSmartList" });
  await userEvent.setup().click(refresh);
  expect(await screen.findByText("0.5 小勺")).toBeVisible();
  expect(screen.queryByRole("button", { name: "shopping.refreshSmartList" })).not.toBeInTheDocument();
});

test("keeps planned meals in preparation mode and removes them from smart mode", async () => {
  const storage = stubSessionStorage();
  storage.set("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [],
    likely_pantry: [],
    purchase_items: [
      { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
    ],
    _ui: { hidden: [], checked: [] },
  }));
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) {
      return Promise.resolve(jsonResponse([
        { date: "2026-08-10", breakfast: ["rice-bowl"], lunch: [], dinner: [] },
      ]));
    }
    if (path === "/recipes/rice-bowl") {
      return Promise.resolve(jsonResponse(
        { id: "rice-bowl", title: "Ginger rice bowl", ingredients: [] },
      ));
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  render(<ShoppingListPage />);

  expect(await screen.findByText("Smart mode")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Planned meals" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back to original list" }));
  expect(await screen.findByRole("heading", { name: "Planned meals" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Ginger rice bowl/ })).toBeVisible();
});

test("a refinement completing after sign-out cannot write groceries into the next account", async () => {
  const storage = stubSessionStorage();
  bindUserStorage("alice");
  const pending = deferredResponse();
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) return Promise.resolve(jsonResponse([{ name: "Alice private rice", total_quantity: "1 bag" }]));
    if (path.startsWith("/meal-plan?") || path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/shopping-list/refine") return pending.promise;
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  const { unmount } = render(<ShoppingListPage />);
  await user.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith("/shopping-list/refine", expect.anything()));
  unmount();
  clearUserStorage();
  bindUserStorage("bob");
  await act(async () => {
    pending.resolve(jsonResponse({ remove: [], likely_pantry: [], purchase_items: [{ name: "Alice private rice", suggested_purchase: "1 bag" }] }));
    await pending.promise;
  });
  expect(storage.has("smartShoppingList:2026-08-10:user:bob")).toBe(false);
});

test("bulk loading renders fresh cache hits before serial misses and advances progress per result", async () => {
  const storage = stubSessionStorage();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Beans", suggested_purchase: "1 can", category: "Produce" },
        { name: "Milk", suggested_purchase: "1 carton", category: "Dairy" },
        { name: "Eggs", suggested_purchase: "1 dozen", category: "Dairy" },
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );

  const pending = new Map<string, ReturnType<typeof deferredResponse>>();
  const started: string[] = [];
  mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products/batch") {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ queries: ["Beans", "Rice", "Milk", "Eggs"] });
      return Promise.resolve(jsonResponse({
        entries: [
          { query: "Rice", status: "fresh", products: [{ name: "Cached rice", price: "$1", image: "", url: "https://www.sayweee.com/product/cached-rice" }], expires_at: nearFutureExpiry() },
          { query: "Milk", status: "missing", products: [], expires_at: null },
          { query: "Beans", status: "fresh", products: [{ name: "Cached beans", price: "$2", image: "", url: "https://www.sayweee.com/product/cached-beans" }], expires_at: nearFutureExpiry() },
          { query: "Eggs", status: "missing", products: [], expires_at: null },
        ],
      }));
    }
    if (path.startsWith("/store-products?query=")) {
      const query = decodeURIComponent(path.split("query=")[1]);
      started.push(query);
      const response = deferredResponse();
      pending.set(query, response);
      return response.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  render(<ShoppingListPage />);
  await user.click(await screen.findByRole("button", { name: /Load top picks from Weee/ }));

  expect(await screen.findByText("Cached rice")).toBeVisible();
  expect(screen.getByText("Cached beans")).toBeVisible();
  await waitFor(() => expect(started).toEqual(["Milk"]));
  expect(screen.getByText(/Loading store matches.*2 of 4/)).toBeVisible();
  pending.get("Milk")?.resolve(productResponse([{ name: "Milk", price: "$3", image: "", url: "https://www.sayweee.com/product/milk" }]));
  await waitFor(() => expect(started).toEqual(["Milk", "Eggs"]));
  expect(screen.getByText(/Loading store matches.*3 of 4/)).toBeVisible();
  pending.get("Eggs")?.resolve(productResponse([{ name: "Eggs", price: "$4", image: "", url: "https://www.sayweee.com/product/eggs" }]));
  await screen.findByRole("button", { name: /Load top picks from Weee/ });
});

test("retains a hydrated unexpired safe positive without a live request", async () => {
  const storage = stubSessionStorage();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );
  storage.set(
    "smartShoppingProducts:2026-08-10:weee",
    JSON.stringify({
      open: { rice: true },
      lookup: {
        rice: {
          status: "success",
          expiresAt: nearFutureExpiry(),
          products: [
            {
              name: "Stored rice",
              price: "$0.01",
              image: "",
              url: "https://www.sayweee.com/product/rice",
            },
          ],
        },
      },
    }),
  );

  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path.startsWith("/store-products")) throw new Error("A retained success must not revalidate before expiry");
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<ShoppingListPage />);

  expect(await screen.findByText("Stored rice")).toBeVisible();
  expect(
    mockApiFetch.mock.calls.some(
      ([path]) => path === "/store-products?query=rice",
    ),
  ).toBe(false);
});

test("Retry keeps the generic panel error and replaces it with a valid product", async () => {
  const storage = stubSessionStorage();
  storage.set("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [],
    purchase_items: [{ name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" }],
    _ui: { hidden: [], checked: [] },
  }));
  let calls = 0;
  const recovered = deferredResponse();
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products?query=Rice") {
      calls += 1;
      return calls === 1
        ? Promise.resolve(new Response("busy", { status: 503 }))
        : recovered.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  render(<ShoppingListPage />);
  await user.click((await screen.findAllByRole("button", { name: "View products" }))[0]);
  expect(await screen.findByText("Could not load products from Weee.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Finding matches on Weee…")).toBeVisible();
  recovered.resolve(productResponse([{ name: "Recovered rice", price: "$2", image: "", url: "https://www.sayweee.com/product/recovered-rice" }]));
  expect(await screen.findByText("Recovered rice")).toBeVisible();
  expect(calls).toBe(2);
});

test.each(["single", "bulk"])(
  "%s first load accepts fresh picks when the server clock is ahead and retains them on reload",
  async (mode) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T17:00:00.000Z"));
    const storage = stubSessionStorage();
    storage.set("smartShoppingList:2026-08-10", JSON.stringify({
      remove: [], likely_pantry: [],
      purchase_items: [{ name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" }],
      _ui: { hidden: [], checked: [] },
    }));
    const products = [{
      name: "Fresh rice", price: "$2.99", image: "",
      url: "https://www.sayweee.com/product/fresh-rice",
    }];
    const serverTime = "2026-09-24T17:00:16.500Z";
    const serverExpiry = "2026-09-25T17:00:16.500Z";
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/shopping-list?")) {
        return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
      }
      if (path.startsWith("/meal-plan?") || path === "/recipes") return Promise.resolve(jsonResponse([]));
      if (mode === "single" && path === "/store-products?query=Rice") {
        // Fifteen seconds of lookup time, with the API clock still 1.5 seconds ahead.
        vi.setSystemTime(new Date("2026-09-24T17:00:15.000Z"));
        return Promise.resolve(jsonResponse({ products, expires_at: serverExpiry, server_time: serverTime }));
      }
      if (mode === "bulk" && path === "/store-products/batch") {
        vi.setSystemTime(new Date("2026-09-24T17:00:15.000Z"));
        return Promise.resolve(jsonResponse({
          server_time: serverTime,
          entries: [{ query: "Rice", status: "fresh", products, expires_at: serverExpiry }],
        }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const user = userEvent.setup();
    const rendered = render(<ShoppingListPage />);
    await user.click(await screen.findByRole("button", {
      name: mode === "single" ? "View products" : "Load top picks from Weee",
    }));

    expect(await screen.findByText("Fresh rice")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Fresh rice: Selected for cart" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    const persisted = JSON.parse(storage.get("smartShoppingProducts:2026-08-10:weee") ?? "{}");
    expect(persisted.lookup.rice).toMatchObject({
      status: "success",
      // Request time is charged against freshness; the server offset is not persisted.
      expiresAt: "2026-09-25T17:00:00.000Z",
    });

    rendered.unmount();
    render(<ShoppingListPage />);
    expect(await screen.findByText("Fresh rice")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Fresh rice: Selected for cart" })).toBeChecked();
    expect(mockApiFetch.mock.calls.filter(([path]) => path.startsWith("/store-products"))).toHaveLength(1);
  },
);

test("reload requeues an open product panel whose persisted lookup is missing", async () => {
  const storage = stubSessionStorage();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Jasmine Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );
  storage.set(
    "smartShoppingProducts:2026-08-10:weee",
    JSON.stringify({
      open: { "jasmine rice": true },
      lookup: {},
    }),
  );

  const freshResponse = deferredResponse();
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Jasmine Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products?query=Jasmine%20Rice") return freshResponse.promise;
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<ShoppingListPage />);

  expect(await screen.findByText("Finding matches on Weee…")).toBeVisible();
  expect(mockApiFetch).toHaveBeenCalledWith(
    "/store-products?query=Jasmine%20Rice",
    { signal: expect.any(AbortSignal) },
  );

  freshResponse.resolve(
    productResponse([
      {
        name: "Fresh rice",
        price: "$2.99",
        image: "",
        url: "https://www.sayweee.com/product/rice",
      },
    ]),
  );
  expect(await screen.findByText("Fresh rice")).toBeVisible();
  await waitFor(() => {
    const persisted = JSON.parse(
      storage.get("smartShoppingProducts:2026-08-10:weee") ?? "{}",
    );
    expect(persisted.queries).toEqual({ "jasmine rice": "Jasmine Rice" });
  });
});

test("continues rendering and loading products when sessionStorage writes throw", async () => {
  const storage = new Map<string, string>();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );
  stubThrowingSessionStorage(storage);
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products?query=Rice") {
      return Promise.resolve(
        productResponse([
          {
            name: "Fresh rice",
            price: "$2.99",
            image: "",
            url: "https://www.sayweee.com/product/rice",
          },
        ]),
      );
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  render(<ShoppingListPage />);
  await user.click((await screen.findAllByRole("button", { name: "View products" }))[0]);

  expect(await screen.findByText("Fresh rice")).toBeVisible();
  expect(screen.getByRole("button", { name: /Load top picks from Weee/ })).toBeEnabled();
});

test("back to original tombstones cart progress before a failed removal and remount", async () => {
  const storage = new Map<string, string>();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );
  storage.set(
    "smartShoppingProducts:2026-08-10:weee",
    JSON.stringify({
      open: { rice: true },
      queries: { rice: "Rice" },
      lookup: {
        rice: {
          status: "success",
          expiresAt: nearFutureExpiry(),
          products: cartProducts.Rice,
        },
      },
    }),
  );
  const riceToken = JSON.stringify(["rice", "https://www.sayweee.com/product/rice"]);
  storage.set(
    "smartShoppingCart:2026-08-10:weee",
    JSON.stringify({ selectedUrlByIngredient: {}, confirmedTokens: [riceToken] }),
  );
  stubRemoveThrowingSessionStorage(storage);
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  const rendered = render(<ShoppingListPage />);
  expect(await screen.findByText("Smart mode")).toBeVisible();

  await user.click(screen.getByRole("button", { name: /Back to original list/ }));

  expect(screen.queryByText("Smart mode")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expect(JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}")).toEqual({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });

  rendered.unmount();
  render(<ShoppingListPage />);
  await user.click(await screen.findByRole("button", { name: "Review Weee cart (1)" }));
  expect(screen.getByText("0 marked as added")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Next: Rice" })).toBeVisible();
});

test("suppresses same-session cart resurrection when storage write and removal are both denied", async () => {
  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-24"));
  const storage = new Map<string, string>();
  storage.set(
    "smartShoppingList:2026-08-24",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );
  storage.set(
    "smartShoppingProducts:2026-08-24:weee",
    JSON.stringify({
      open: { rice: true },
      queries: { rice: "Rice" },
      lookup: {
        rice: {
          status: "success",
          expiresAt: nearFutureExpiry(),
          products: cartProducts.Rice,
        },
      },
    }),
  );
  storage.set(
    "smartShoppingCart:2026-08-24:weee",
    JSON.stringify({
      selectedUrlByIngredient: {},
      confirmedTokens: [JSON.stringify(["rice", "https://www.sayweee.com/product/rice"])],
    }),
  );
  stubUnavailableSessionStorage(storage);
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  const rendered = render(<ShoppingListPage />);

  expect(await screen.findByText("Smart mode")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Back to original list/ }));
  rendered.unmount();
  render(<ShoppingListPage />);

  await user.click(await screen.findByRole("button", { name: "Review Weee cart (1)" }));
  expect(screen.getByText("0 marked as added")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Next: Rice" })).toBeVisible();
});

test("successful smart-list preparation survives a sessionStorage removal error", async () => {
  const storage = new Map<string, string>();
  stubRemoveThrowingSessionStorage(storage);
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/shopping-list/refine") {
      return Promise.resolve(
        jsonResponse({
          remove: [],
          likely_pantry: [],
          purchase_items: [
            { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
          ],
        }),
      );
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  const { rerender } = render(<ShoppingListPage />);
  await user.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));

  expect(await screen.findByText("Smart mode")).toBeVisible();
  const persisted = storage.get("smartShoppingList:2026-08-10");
  expect(persisted).toBeTruthy();
  expect(JSON.parse(persisted ?? "{}").purchase_items).toEqual([
    { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
  ]);

  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-17"));
  rerender(<ShoppingListPage />);
  expect(await screen.findByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
  expect(
    screen.queryByText(/Storage access denied|Something went wrong/),
  ).not.toBeInTheDocument();
});

test("ignores a late smart-list refresh from the previous week without clearing the destination cart", async () => {
  const storage = stubSessionStorage();
  const weekBToken = JSON.stringify(["tofu", "https://www.sayweee.com/product/tofu"]);
  storage.set(
    "smartShoppingList:2026-08-17",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Tofu", suggested_purchase: "2 packs", category: "Produce" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );
  storage.set(
    "smartShoppingProducts:2026-08-17:weee",
    JSON.stringify({
      open: { tofu: true },
      queries: { tofu: "Tofu" },
      lookup: {
        tofu: {
          status: "success",
          expiresAt: nearFutureExpiry(),
          products: [{
            name: "Week B tofu",
            price: "$3.00",
            image: "",
            url: "https://www.sayweee.com/product/tofu",
          }],
        },
      },
    }),
  );
  storage.set(
    "smartShoppingCart:2026-08-17:weee",
    JSON.stringify({ selectedUrlByIngredient: {}, confirmedTokens: [weekBToken] }),
  );

  const lateWeekARefresh = deferredResponse();
  let weekAListCalls = 0;
  let refineCalls = 0;
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?start=2026-08-10")) {
      weekAListCalls += 1;
      if (weekAListCalls === 1) {
        return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
      }
      return lateWeekARefresh.promise;
    }
    if (path.startsWith("/shopping-list?start=2026-08-17")) {
      return Promise.resolve(jsonResponse([{ name: "Tofu", total_quantity: "2 packs" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/shopping-list/refine") {
      refineCalls += 1;
      return Promise.resolve(jsonResponse({
        remove: [],
        likely_pantry: [],
        purchase_items: [
          { name: "Late rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
        ],
      }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  const rendered = render(<ShoppingListPage />);
  await user.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  await waitFor(() => expect(weekAListCalls).toBe(2));

  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-17"));
  rendered.rerender(<ShoppingListPage />);
  const weekBReview = await screen.findByRole("button", { name: "Review Weee cart (1)" });
  await user.click(weekBReview);
  expect(screen.getByText("Week B tofu · $3.00")).toBeVisible();
  expect(screen.getByText("1 marked as added")).toBeVisible();

  await act(async () => {
    lateWeekARefresh.resolve(jsonResponse([{ name: "Late rice", total_quantity: "1 bag" }]));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(refineCalls).toBe(0);
  expect(screen.getByRole("dialog", { name: "Review Weee cart" })).toBeVisible();
  expect(screen.getByText("Week B tofu · $3.00")).toBeVisible();
  expect(JSON.parse(storage.get("smartShoppingCart:2026-08-17:weee") ?? "{}").confirmedTokens)
    .toContain(weekBToken);
});

test("clears a displayed result and revalidates at the exact backend expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  const expiryDelay = 1_000;
  const expiry = new Date(Date.now() + expiryDelay).toISOString();
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  const storage = stubSessionStorage();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );

  const revalidation = deferredResponse();
  let productCalls = 0;
  const productQueries: string[] = [];
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path.startsWith("/store-products?query=")) {
      productCalls += 1;
      productQueries.push(decodeURIComponent(path.split("query=")[1]));
      if (productCalls === 1) {
        return Promise.resolve(
          productResponse(
            [
              {
                name: "Fresh rice",
                price: "$2.99",
                image: "",
                url: "https://www.sayweee.com/product/rice",
              },
            ],
            expiry,
          ),
        );
      }
      return revalidation.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<ShoppingListPage />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  const viewButton = screen.getAllByRole("button", { name: "View products" })[0];
  fireEvent.click(viewButton);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText("Fresh rice")).toBeVisible();
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expiryDelay);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(expiryDelay - 1);
  });
  expect(screen.getByText("Fresh rice")).toBeVisible();
  expect(productCalls).toBe(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.queryByText("Fresh rice")).not.toBeInTheDocument();
  expect(screen.getByText("Finding matches on Weee…")).toBeVisible();
  expect(productCalls).toBe(2);
  expect(productQueries).toEqual(["Rice", "Rice"]);

  vi.useRealTimers();
});

test("retains confirmed progress while a product revalidates and prunes it after a settled empty result", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  const expiryDelay = 1_000;
  const expiry = new Date(Date.now() + expiryDelay).toISOString();
  const storage = stubSessionStorage();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );

  const revalidation = deferredResponse();
  let productCalls = 0;
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products?query=Rice") {
      productCalls += 1;
      if (productCalls === 1) {
        return Promise.resolve(productResponse([
          {
            name: "Fresh rice",
            price: "$2.99",
            image: "",
            url: "https://www.sayweee.com/product/rice",
          },
        ], expiry));
      }
      return revalidation.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<ShoppingListPage />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.click(screen.getAllByRole("button", { name: "View products" })[0]);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Review Weee cart (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "I added it" }));

  const riceToken = JSON.stringify(["rice", "https://www.sayweee.com/product/rice"]);
  await act(async () => {
    await Promise.resolve();
  });
  expect(JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}").confirmedTokens)
    .toContain(riceToken);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(expiryDelay);
  });
  expect(screen.getByText("1 finding a match")).toBeVisible();
  expect(JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}").confirmedTokens)
    .toContain(riceToken);

  fireEvent.click(screen.getByRole("button", { name: "Close Weee cart review" }));
  expect(screen.getByRole("button", { name: "Load top picks from Weee" })).toHaveFocus();

  await act(async () => {
    revalidation.resolve(productResponse([]));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.queryByRole("button", { name: /Review Weee cart/ })).not.toBeInTheDocument();
  expect(JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}").confirmedTokens)
    .not.toContain(riceToken);

  vi.useRealTimers();
});

test.each(["clear", "unmount"] as const)(
  "%s aborts and settles the active product generation",
  async (action) => {
    const storage = stubSessionStorage();
    storage.set(
      "smartShoppingList:2026-08-10",
      JSON.stringify({
        remove: [],
        likely_pantry: [],
        purchase_items: [
          { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
        ],
        _ui: { hidden: [], checked: [] },
      }),
    );
    const pending = deferredResponse();
    let productSignal: AbortSignal | undefined;
    mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith("/shopping-list?")) {
        return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
      }
      if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
      if (path === "/recipes") return Promise.resolve(jsonResponse([]));
      if (path === "/store-products?query=Rice") {
        productSignal = init?.signal ?? undefined;
        return pending.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const user = userEvent.setup();
    const rendered = render(<ShoppingListPage />);
    await user.click((await screen.findAllByRole("button", { name: "View products" }))[0]);
    expect(await screen.findByText("Finding matches on Weee…")).toBeVisible();
    await waitFor(() => expect(productSignal).toBeDefined());

    if (action === "clear") {
      await user.click(screen.getByRole("button", { name: /Back to original list/ }));
    } else {
      rendered.unmount();
    }

    expect(productSignal?.aborted).toBe(true);
  },
);

function seedCartShoppingList(
  storage: Map<string, string>,
  ui: { hidden?: number[]; checked?: number[] } = {},
) {
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
        { name: "Kale", suggested_purchase: "2 bunches", category: "Produce" },
        { name: "Ginger", suggested_purchase: "1 knob", category: "Produce" },
      ],
      _ui: { hidden: ui.hidden ?? [], checked: ui.checked ?? [] },
    }),
  );
}

const cartProducts = {
  Rice: [
    { name: "Jasmine rice", price: "$2.00", image: "", url: "https://www.sayweee.com/product/rice" },
    { name: "Brown rice", price: "$4.00", image: "", url: "https://www.sayweee.com/product/brown-rice" },
  ],
  Kale: [
    { name: "Organic kale", price: "$3.00", image: "", url: "https://www.sayweee.com/product/kale" },
  ],
  Ginger: [
    { name: "Fresh ginger", price: "$1.00", image: "", url: "https://www.sayweee.com/product/ginger" },
  ],
} as const;

function stubCartApi() {
  mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products/batch") {
      const queries = JSON.parse(String(init?.body)).queries as Array<keyof typeof cartProducts>;
      return Promise.resolve(jsonResponse({
        entries: queries.map((query) => ({
          query,
          status: "fresh",
          products: cartProducts[query] ?? [],
          expires_at: nearFutureExpiry(),
        })),
      }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

test("builds a review from successful matches, derives top picks, updates an alternative, and restores trigger focus", async () => {
  const storage = stubSessionStorage();
  seedCartShoppingList(storage);
  stubCartApi();
  const user = userEvent.setup();

  render(<ShoppingListPage />);
  expect(await screen.findByText("Smart mode")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Review Weee cart/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Load top picks from Weee" }));
  const review = await screen.findByRole("button", { name: "Review Weee cart (3)" });
  await waitFor(() => {
    const saved = JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}");
    expect(saved.selectedUrlByIngredient).toEqual({});
  });
  await user.click(review);
  expect(screen.getByRole("dialog", { name: "Review Weee cart" })).toBeVisible();
  expect(screen.getByText("Estimated subtotal: $6.00")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Next: Kale" })).toBeVisible();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(review).toHaveFocus());
  await user.click(screen.getByRole("radio", { name: "Choose Brown rice for cart" }));
  await user.click(review);
  expect(screen.getByText("Estimated subtotal: $8.00")).toBeVisible();
  expect(screen.getByText(/Brown rice · \$4\.00/)).toBeVisible();
});

test("opens one verified current product, persists explicit confirmation, and clears it when the product changes", async () => {
  const storage = stubSessionStorage();
  seedCartShoppingList(storage);
  stubCartApi();
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  const user = userEvent.setup();

  render(<ShoppingListPage />);
  await user.click(await screen.findByRole("button", { name: "Load top picks from Weee" }));
  const review = await screen.findByRole("button", { name: "Review Weee cart (3)" });
  await user.click(review);
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  await user.click(screen.getByRole("button", { name: "Open next on Weee" }));
  expect(openSpy).toHaveBeenCalledTimes(1);
  expect(openSpy).toHaveBeenCalledWith(
    "https://www.sayweee.com/product/rice",
    "_blank",
    "noopener,noreferrer",
  );

  await user.click(screen.getByRole("button", { name: "I added it" }));
  const riceToken = JSON.stringify(["rice", "https://www.sayweee.com/product/rice"]);
  expect(screen.getByRole("heading", { name: "Review pass complete" })).toBeVisible();
  await waitFor(() => {
    const saved = JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}");
    expect(saved.confirmedTokens).toContain(riceToken);
  });

  await user.click(screen.getByRole("button", { name: "Close Weee cart review" }));
  await user.click(screen.getByRole("radio", { name: "Jasmine rice: Selected for cart" }));
  await waitFor(() => {
    const saved = JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}");
    expect(saved.selectedUrlByIngredient).toEqual({});
    expect(saved.confirmedTokens).toContain(riceToken);
  });
  await user.click(screen.getByRole("radio", { name: "Choose Brown rice for cart" }));
  await waitFor(() => {
    const saved = JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}");
    expect(saved.selectedUrlByIngredient.rice).toBe("https://www.sayweee.com/product/brown-rice");
    expect(saved.confirmedTokens).not.toContain(riceToken);
  });
});

test.each(["check", "hide"] as const)(
  "%s keeps a canonical confirmation while a duplicate row remains eligible and clears it after the last row leaves",
  async (action) => {
    const storage = stubSessionStorage();
    storage.set(
      "smartShoppingList:2026-08-10",
      JSON.stringify({
        remove: [],
        likely_pantry: [],
        purchase_items: [
          { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
          { name: " RICE ", suggested_purchase: "2 bags", category: "Pantry & Dry Goods" },
        ],
        _ui: { hidden: [], checked: [] },
      }),
    );
    stubCartApi();
    const user = userEvent.setup();

    render(<ShoppingListPage />);
    await user.click(await screen.findByRole("button", { name: "Load top picks from Weee" }));
    await user.click(await screen.findByRole("button", { name: "Review Weee cart (1)" }));
    await user.click(screen.getByRole("button", { name: "I added it" }));
    await user.click(screen.getByRole("button", { name: "Close Weee cart review" }));

    const riceToken = JSON.stringify(["rice", "https://www.sayweee.com/product/rice"]);
    await waitFor(() => {
      const saved = JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}");
      expect(saved.confirmedTokens).toContain(riceToken);
    });

    const removeFirstEligibleRow = async () => {
      if (action === "check") {
        await user.click(screen.getAllByRole("checkbox")[0]);
        return;
      }
      await user.click(screen.getAllByRole("button", { name: /shopping\.more/ })[0]);
      await user.click(screen.getByRole("button", { name: "shopping.removeFromList" }));
    };

    await removeFirstEligibleRow();
    await waitFor(() => {
      const saved = JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}");
      expect(saved.confirmedTokens).toContain(riceToken);
    });

    await removeFirstEligibleRow();
    await waitFor(() => {
      const saved = JSON.parse(storage.get("smartShoppingCart:2026-08-10:weee") ?? "{}");
      expect(saved.confirmedTokens).not.toContain(riceToken);
    });
  },
);

test("excludes checked and hidden ingredients and tolerates malformed cart data plus failed writes", async () => {
  const storage = new Map<string, string>();
  seedCartShoppingList(storage, { hidden: [1], checked: [0] });
  storage.set("smartShoppingCart:2026-08-10:weee", "{not-json");
  storage.set(
    "smartShoppingProducts:2026-08-10:weee",
    JSON.stringify({
      open: { rice: true, kale: true, ginger: true },
      queries: { rice: "Rice", kale: "Kale", ginger: "Ginger" },
      lookup: Object.fromEntries(
        Object.entries(cartProducts).map(([name, products]) => [
          name.toLowerCase(),
          { status: "success", expiresAt: nearFutureExpiry(), products },
        ]),
      ),
    }),
  );
  stubThrowingSessionStorage(storage);
  stubCartApi();
  const user = userEvent.setup();

  render(<ShoppingListPage />);
  const review = await screen.findByRole("button", { name: "Review Weee cart (1)" });
  await user.click(review);

  expect(screen.getByRole("heading", { name: "Next: Ginger" })).toBeVisible();
  expect(screen.getByText("1 ready")).toBeVisible();
  expect(screen.queryByText(/Jasmine rice ·/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Organic kale ·/)).not.toBeInTheDocument();
});

test("hydrates a week-scoped explicit alternative and confirmation, then clears cart state on back", async () => {
  const storage = stubSessionStorage();
  seedCartShoppingList(storage);
  const riceToken = JSON.stringify(["rice", "https://www.sayweee.com/product/brown-rice"]);
  storage.set(
    "smartShoppingCart:2026-08-10:weee",
    JSON.stringify({
      selectedUrlByIngredient: { rice: "https://www.sayweee.com/product/brown-rice" },
      confirmedTokens: [riceToken],
    }),
  );
  storage.set(
    "smartShoppingProducts:2026-08-10:weee",
    JSON.stringify({
      open: { rice: true, kale: true, ginger: true },
      queries: { rice: "Rice", kale: "Kale", ginger: "Ginger" },
      lookup: Object.fromEntries(
        Object.entries(cartProducts).map(([name, products]) => [
          name.toLowerCase(),
          { status: "success", expiresAt: nearFutureExpiry(), products },
        ]),
      ),
    }),
  );
  stubCartApi();
  const user = userEvent.setup();

  render(<ShoppingListPage />);
  const review = await screen.findByRole("button", { name: "Review Weee cart (3)" });
  await user.click(review);
  expect(screen.getByText("Estimated subtotal: $8.00")).toBeVisible();
  expect(screen.getByText("1 marked as added")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Next: Kale" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Close Weee cart review" }));
  await user.click(screen.getByRole("button", { name: "Back to original list" }));
  expect(storage.has("smartShoppingCart:2026-08-10:weee")).toBe(false);
  expect(screen.queryByRole("button", { name: /Review Weee cart/ })).not.toBeInTheDocument();
});

test("advances a skipped item only for the open review session", async () => {
  const storage = stubSessionStorage();
  seedCartShoppingList(storage);
  stubCartApi();
  const user = userEvent.setup();

  render(<ShoppingListPage />);
  await user.click(await screen.findByRole("button", { name: "Load top picks from Weee" }));
  const review = await screen.findByRole("button", { name: "Review Weee cart (3)" });
  await user.click(review);
  expect(screen.getByRole("heading", { name: "Next: Kale" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  expect(screen.getByRole("heading", { name: "Next: Ginger" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close Weee cart review" }));
  await user.click(review);
  expect(screen.getByRole("heading", { name: "Next: Kale" })).toBeVisible();
});


test("uses the same category order for sections, cart review, and Muse while retaining source row indices", async () => {
  const storage = stubSessionStorage();
  storage.set("smartShoppingList:2026-08-10", JSON.stringify({
    remove: [], likely_pantry: [],
    purchase_items: [
      { name: "Milk", suggested_purchase: "1 carton", category: "Dairy" },
      { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
      { name: "Kale", suggested_purchase: "1 bunch", category: "Produce" },
      { name: "Beef", suggested_purchase: "1 lb", category: "Meat & Seafood" },
    ], _ui: { hidden: [], checked: [] },
  }));
  mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path.startsWith("/shopping-list?")) return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    if (path.startsWith("/meal-plan?") || path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products/batch") {
      const { queries } = JSON.parse(String(init?.body)) as { queries: string[] };
      return Promise.resolve(jsonResponse({ entries: queries.map(query => ({
        query, status: "fresh", expires_at: nearFutureExpiry(),
        products: [{ name: `${query} product`, price: "$2", image: "", url: `https://www.sayweee.com/product/${query.toLowerCase()}` }],
      })) }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<ShoppingListPage />);
  await screen.findByRole("heading", { name: "Meat & Seafood" });
  const categories = ["Meat & Seafood", "Produce", "Pantry & Dry Goods", "Dairy"];
  expect(screen.getAllByRole("heading").map(heading => heading.textContent).filter(name => categories.includes(name ?? ""))).toEqual(categories);
  await user.click(screen.getByRole("button", { name: "Load top picks from Weee" }));
  await user.click(await screen.findByRole("button", { name: "Review Weee cart (4)" }));
  expect(screen.getByRole("heading", { name: "Next: Beef" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close Weee cart review" }));
  await user.click(screen.getByRole("button", { name: "shopping.museEntry" }));
  const muse = screen.getByRole("dialog", { name: "shopping.museReviewTitle" });
  expect(within(muse).getAllByRole("spinbutton").map(input => input.closest("li")?.querySelector("strong")?.textContent)).toEqual([
    "Beef product", "Kale product", "Rice product", "Milk product",
  ]);
  await user.click(screen.getByRole("button", { name: "shopping.museClose" }));
  await user.click(screen.getAllByRole("checkbox")[0]);
  await waitFor(() => {
    const saved = JSON.parse(storage.get("smartShoppingList:2026-08-10") ?? "{}");
    expect(saved._ui.checked).toEqual([3]);
    expect(saved.purchase_items.map((item: {name: string}) => item.name)).toEqual(["Milk", "Rice", "Kale", "Beef"]);
  });
});

test("late fallback after account change cannot publish the previous account's groceries", async () => {
  const storage = stubSessionStorage();
  bindUserStorage("alice");
  const pending = deferredResponse();
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) return Promise.resolve(jsonResponse([{ name: "Private rice", total_quantity: "2 cups" }]));
    if (path.startsWith("/meal-plan?") || path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/shopping-list/refine") return pending.promise;
    throw new Error(`Unexpected request: ${path}`);
  });
  render(<ShoppingListPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare smart shopping list" }));
  await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith("/shopping-list/refine", expect.anything()));
  clearUserStorage();
  bindUserStorage("bob");
  await act(async () => { pending.resolve(new Response("{}", { status: 503 })); });
  expect(storage.has("smartShoppingList:2026-08-10:user:bob")).toBe(false);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
