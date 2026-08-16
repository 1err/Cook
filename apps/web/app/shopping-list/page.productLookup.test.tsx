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

test("manual and bulk aliases share one request under the global four-request ceiling", async () => {
  const storage = stubSessionStorage();
  storage.set(
    "smartShoppingList:2026-08-10",
    JSON.stringify({
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry & Dry Goods" },
        { name: " rice ", suggested_purchase: "1 bag", category: "Produce" },
        { name: "Beans", suggested_purchase: "1 can", category: "Produce" },
        { name: "Milk", suggested_purchase: "1 carton", category: "Dairy" },
        { name: "Eggs", suggested_purchase: "1 dozen", category: "Dairy" },
        { name: "Flour", suggested_purchase: "1 bag", category: "Bakery" },
      ],
      _ui: { hidden: [], checked: [] },
    }),
  );

  const pending = new Map<string, ReturnType<typeof deferredResponse>>();
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path.startsWith("/store-products?query=")) {
      const query = decodeURIComponent(path.split("query=")[1]);
      started.push(query);
      active += 1;
      peak = Math.max(peak, active);
      const response = deferredResponse();
      pending.set(query, response);
      return response.promise.finally(() => {
        active -= 1;
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });

  const user = userEvent.setup();
  render(<ShoppingListPage />);
  const viewButtons = await screen.findAllByRole("button", { name: "View products" });
  await user.click(viewButtons[0]);
  await waitFor(() => expect(started).toEqual(["Rice"]));
  await user.click(screen.getByRole("button", { name: /Load top picks from Weee/ }));

  await waitFor(() => expect(started).toEqual(["Rice", "Beans", "Milk", "Eggs"]));
  expect(peak).toBe(4);
  expect(started.filter((name) => name.trim().toLocaleLowerCase() === "rice")).toHaveLength(1);

  pending.get("Rice")?.resolve(productResponse([{ name: "Rice", price: "$1", image: "", url: "https://www.sayweee.com/product/rice" }]));
  await waitFor(() => expect(started).toEqual(["Rice", "Beans", "Milk", "Eggs", "Flour"]));
  for (const [query, response] of pending) {
    if (query !== "Rice") {
      response.resolve(productResponse([{ name: query, price: "$1", image: "", url: `https://www.sayweee.com/product/${query}` }]));
    }
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Load top picks from Weee/ })).toBeEnabled(),
  );
  expect(peak).toBe(4);
});

test("revalidates a hydrated positive before displaying any stored product", async () => {
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
              url: "https://sayweee.com.evil.test/product/rice",
            },
          ],
        },
      },
    }),
  );

  const freshResponse = deferredResponse();
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products?query=rice") return freshResponse.promise;
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<ShoppingListPage />);

  expect(await screen.findByText("Finding matches on Weee…")).toBeVisible();
  expect(screen.queryByText("Stored rice")).not.toBeInTheDocument();
  expect(mockApiFetch).toHaveBeenCalledWith("/store-products?query=rice");

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
  expect(screen.queryByText("Stored rice")).not.toBeInTheDocument();
});

test("reload requeues an open product panel whose persisted lookup is missing", async () => {
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
      lookup: {},
    }),
  );

  const freshResponse = deferredResponse();
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/shopping-list?")) {
      return Promise.resolve(jsonResponse([{ name: "Rice", total_quantity: "1 bag" }]));
    }
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") return Promise.resolve(jsonResponse([]));
    if (path === "/store-products?query=rice") return freshResponse.promise;
    throw new Error(`Unexpected request: ${path}`);
  });

  render(<ShoppingListPage />);

  expect(await screen.findByText("Finding matches on Weee…")).toBeVisible();
  expect(mockApiFetch).toHaveBeenCalledWith("/store-products?query=rice");

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

test("clears a displayed result and revalidates at the exact backend expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
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
    if (path.startsWith("/store-products?query=")) {
      productCalls += 1;
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
            "2026-08-15T12:00:01.000Z",
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

  await act(async () => {
    await vi.advanceTimersByTimeAsync(999);
  });
  expect(screen.getByText("Fresh rice")).toBeVisible();
  expect(productCalls).toBe(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.queryByText("Fresh rice")).not.toBeInTheDocument();
  expect(screen.getByText("Finding matches on Weee…")).toBeVisible();
  expect(productCalls).toBe(2);

  vi.useRealTimers();
});
