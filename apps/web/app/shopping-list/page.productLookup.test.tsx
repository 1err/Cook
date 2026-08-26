import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ShoppingListPage from "./page";

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

beforeEach(() => {
  mockUseRouter.mockReturnValue({ push: vi.fn() });
  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-10"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
      expect(JSON.parse(String(init?.body))).toEqual({ queries: ["Rice", "Beans", "Milk", "Eggs"] });
      return Promise.resolve(jsonResponse({
        entries: [
          { query: "Rice", status: "fresh", products: [{ name: "Cached rice", price: "$1", image: "", url: "https://www.sayweee.com/product/cached-rice" }], expires_at: "2099-01-01T00:00:00.000Z" },
          { query: "Milk", status: "missing", products: [], expires_at: null },
          { query: "Beans", status: "fresh", products: [{ name: "Cached beans", price: "$2", image: "", url: "https://www.sayweee.com/product/cached-beans" }], expires_at: "2099-01-01T00:00:00.000Z" },
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
          expiresAt: "2099-01-01T00:00:00.000Z",
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
  expect(mockApiFetch).not.toHaveBeenCalledWith("/store-products?query=rice");
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
  expect(mockApiFetch).toHaveBeenCalledWith("/store-products?query=Jasmine%20Rice");

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

test("back to original still clears React state when sessionStorage removal throws", async () => {
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
  render(<ShoppingListPage />);
  expect(await screen.findByText("Smart mode")).toBeVisible();

  await user.click(screen.getByRole("button", { name: /Back to original list/ }));

  expect(screen.queryByText("Smart mode")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
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

test("clears a displayed result and revalidates at the exact backend expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  const maximumSafeTimerDelay = 2_147_483_647;
  const expiryAfterRearm = 1_000;
  const expiry = new Date(Date.now() + maximumSafeTimerDelay + expiryAfterRearm).toISOString();
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
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), maximumSafeTimerDelay);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(maximumSafeTimerDelay);
  });
  expect(screen.getByText("Fresh rice")).toBeVisible();
  expect(productCalls).toBe(1);
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expiryAfterRearm);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(expiryAfterRearm - 1);
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
