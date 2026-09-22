import React from "react";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import type { StoreProductsResponse } from "@cooking/api-client";
import { ShoppingListScreen } from "./ShoppingListScreen";
import { smartCartKey, smartListKey, smartProductsKey } from "./storage";

const mockShoppingList = jest.fn();
const mockMealPlanList = jest.fn();
const mockRecipeList = jest.fn();
const mockRefine = jest.fn();
const mockStoreProducts = jest.fn();
const mockStoreProductsBatch = jest.fn();
const mockStorageValues = new Map<string, unknown>();
const mockStorageGet = jest.fn(async (_store: unknown, key: string) => (
  mockStorageValues.get(key) ?? null
));
const mockStorageSet = jest.fn(async (_store: unknown, key: string, value: unknown) => {
  mockStorageValues.set(key, value);
});
const mockStorageRemove = jest.fn(async (key: string) => {
  mockStorageValues.delete(key);
});

const mockApiClient = {
  shopping: {
    list: mockShoppingList,
    refine: mockRefine,
    storeProducts: mockStoreProducts,
    storeProductsBatch: mockStoreProductsBatch,
  },
  mealPlan: { list: mockMealPlanList },
  recipes: { get: async (id: string) => (await mockRecipeList()).find((r: {id: string}) => r.id === id) },
};

jest.mock("../../lib/api", () => ({ useApiClient: () => mockApiClient }));
jest.mock("../../lib/i18n", () => ({ useT: () => (key: string) => key }));
jest.mock("../../lib/storage", () => ({
  ephemeral: { remove: (...args: unknown[]) => mockStorageRemove(...args as [string]) },
  persistent: {},
  json: {
    get: (...args: unknown[]) => mockStorageGet(...args as [unknown, string]),
    set: (...args: unknown[]) => mockStorageSet(...args as [unknown, string, unknown]),
  },
}));
jest.mock("@react-navigation/native", () => ({ useFocusEffect: jest.fn() }));

const futureExpiry = () => new Date(Date.now() + 60_000).toISOString();
const RICE_URL = "https://www.sayweee.com/product/jasmine-rice";
const RICE_ALT_URL = "https://www.sayweee.com/product/brown-rice";
const BEANS_URL = "https://www.sayweee.com/product/black-beans";

const RICE_REFINED = {
  remove: [],
  likely_pantry: [],
  purchase_items: [{ name: "Rice", suggested_purchase: "1 bag", category: "Pantry" }],
};
const BEANS_REFINED = {
  remove: [],
  likely_pantry: [],
  purchase_items: [{ name: "Beans", suggested_purchase: "2 cans", category: "Pantry" }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function storedProducts(
  key: string,
  query: string,
  name: string,
  price: string,
  url: string,
) {
  const response: StoreProductsResponse = {
    products: [{ name, price, image: "", url }],
    expires_at: futureExpiry(),
  };
  return {
    open: { [key]: true },
    products: { [key]: response },
    errors: { [key]: null },
    queries: { [key]: query },
  };
}

function seedWeek(
  weekStart: string,
  refined: typeof RICE_REFINED,
  products: ReturnType<typeof storedProducts>,
) {
  mockStorageValues.set(smartListKey(weekStart), {
    ...refined,
    _ui: { hidden: [], checked: [] },
    _plannerFingerprint: `old-${weekStart}`,
  });
  mockStorageValues.set(smartProductsKey(weekStart), products);
  mockStorageValues.set(smartCartKey(weekStart), {
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });
}

function navigation() {
  return { setParams: jest.fn(), navigate: jest.fn() };
}

function screenElement(weekStart: string) {
  return (
    <ShoppingListScreen
      navigation={navigation() as never}
      route={{ params: { weekStart } } as never}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorageValues.clear();
  mockShoppingList.mockResolvedValue([{
    id: "shopping-1",
    name: "Rice",
    total_quantity: "1 bag",
    checked: false,
    earliest_date: "2026-08-10",
    latest_date: "2026-08-16",
  }]);
  mockMealPlanList.mockResolvedValue([]);
  mockRecipeList.mockResolvedValue([]);
  mockRefine.mockResolvedValue(RICE_REFINED);
  mockStoreProducts.mockResolvedValue({ products: [], expires_at: null });
  mockStoreProductsBatch.mockResolvedValue({ entries: [] });
});

test("a successful regeneration clears the real live product cache and cart review", async () => {
  seedWeek(
    "2026-08-10",
    RICE_REFINED,
    storedProducts("rice", "Rice", "Jasmine rice", "$2.99", RICE_URL),
  );
  await render(screenElement("2026-08-10"));
  const user = userEvent.setup();

  expect(await screen.findByRole("button", { name: "Review Weee cart · 1" })).toBeOnTheScreen();
  expect(screen.getByText("Jasmine rice")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Refresh smart list" }));

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /Review Weee cart/ })).not.toBeOnTheScreen();
  });
  expect(screen.queryByText("Jasmine rice")).not.toBeOnTheScreen();
  expect(screen.getByText("View products")).toBeOnTheScreen();
});

test("a failed regeneration preserves the real live cache and review progress", async () => {
  seedWeek(
    "2026-08-10",
    RICE_REFINED,
    storedProducts("rice", "Rice", "Jasmine rice", "$2.99", RICE_URL),
  );
  mockRefine.mockRejectedValue(new Error("Refine failed"));
  await render(screenElement("2026-08-10"));
  const user = userEvent.setup();

  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 1" }));
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Refresh smart list" }));

  expect(await screen.findByText("Refine failed")).toBeOnTheScreen();
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
  expect(screen.getByText("Jasmine rice · $2.99")).toBeOnTheScreen();
  expect(mockStorageValues.has(smartProductsKey("2026-08-10"))).toBe(true);
});

test("a week switch makes an in-flight regeneration unable to clear destination products", async () => {
  seedWeek(
    "2026-08-10",
    RICE_REFINED,
    storedProducts("rice", "Rice", "Jasmine rice", "$2.99", RICE_URL),
  );
  seedWeek(
    "2026-08-17",
    BEANS_REFINED,
    storedProducts("beans", "Beans", "Black beans", "$1.99", BEANS_URL),
  );
  const pendingRefine = deferred<typeof RICE_REFINED>();
  mockRefine.mockReturnValueOnce(pendingRefine.promise);
  const rendered = await render(screenElement("2026-08-10"));
  const user = userEvent.setup();

  await user.press(await screen.findByRole("button", { name: "Refresh smart list" }));
  await waitFor(() => expect(mockRefine).toHaveBeenCalledTimes(1));
  await rendered.rerender(screenElement("2026-08-17"));
  expect(await screen.findByText("Black beans")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Review Weee cart · 1" })).toBeOnTheScreen();

  pendingRefine.resolve(RICE_REFINED);
  await pendingRefine.promise;

  await waitFor(() => expect(screen.getByText("Black beans")).toBeOnTheScreen());
  expect(screen.getByRole("button", { name: "Review Weee cart · 1" })).toBeOnTheScreen();
  expect(mockStorageValues.has(smartProductsKey("2026-08-17"))).toBe(true);
});

test("cold hydration keeps a confirmed alternative pending when a closed cached product expired", async () => {
  const weekStart = "2026-08-10";
  const confirmationToken = JSON.stringify(["rice", RICE_ALT_URL]);
  mockStorageValues.set(smartListKey(weekStart), {
    ...RICE_REFINED,
    _ui: { hidden: [], checked: [] },
    _plannerFingerprint: `old-${weekStart}`,
  });
  mockStorageValues.set(smartProductsKey(weekStart), {
    open: { rice: false },
    products: {
      rice: {
        products: [
          { name: "Jasmine rice", price: "$2.99", image: "", url: RICE_URL },
          { name: "Brown rice", price: "$4.99", image: "", url: RICE_ALT_URL },
        ],
        expires_at: "2000-01-01T00:00:00.000Z",
      },
    },
    errors: { rice: null },
    queries: { rice: "Rice" },
  });
  mockStorageValues.set(smartCartKey(weekStart), {
    selectedUrlByIngredient: { rice: RICE_ALT_URL },
    confirmedTokens: [confirmationToken],
  });

  await render(screenElement(weekStart));

  await waitFor(() => {
    expect(mockStorageGet).toHaveBeenCalledWith(expect.anything(), smartCartKey(weekStart));
    expect(mockStorageGet).toHaveBeenCalledWith(expect.anything(), smartProductsKey(weekStart));
  });
  await waitFor(() => {
    expect(mockStorageValues.get(smartCartKey(weekStart))).toEqual({
      selectedUrlByIngredient: { rice: RICE_ALT_URL },
      confirmedTokens: [confirmationToken],
    });
  });
  expect(mockStoreProducts).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Review Weee cart/ })).not.toBeOnTheScreen();
});

test('checks and shares the basic grocery list without refinement and survives an AI failure', async () => {
  const { Share } = require('react-native');
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  mockShoppingList.mockResolvedValue([{ name: 'Rice', total_quantity: '1 bag' }, { name: 'Milk', total_quantity: '1 carton' }]);
  mockRefine.mockRejectedValue(new Error('Monthly AI allowance reached'));
  await render(screenElement('2026-08-10'));
  const user = userEvent.setup();
  await user.press(await screen.findByRole('checkbox', { name: 'Rice' }));
  await user.press(screen.getByRole('button', { name: 'shopping.shareList' }));
  expect(share).toHaveBeenCalledWith({ message: 'Milk — 1 carton' });
  expect(mockRefine).not.toHaveBeenCalled();
  await user.press(screen.getByRole('button', { name: 'Prepare smart shopping list' }));
  await screen.findByText('Monthly AI allowance reached');
  expect(screen.getByRole('checkbox', { name: 'Rice' })).toBeChecked();
  share.mockRestore();
});

test('shows basic groceries when optional meal preview fails', async () => {
  mockMealPlanList.mockRejectedValue(new Error('Meal preview unavailable'));
  await render(screenElement('2026-08-10'));
  expect(await screen.findByRole('checkbox', { name: 'Rice' })).toBeEnabled();
});
