import React from "react";
import { Linking } from "react-native";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { buildCartAssistantDraft, getWeekBounds } from "@cooking/shared";
import {
  ShoppingListScreen,
  buildMobileCartIngredients,
  openCurrentCartProduct,
} from "./ShoppingListScreen";

const mockUseSmartShoppingList = jest.fn();
const mockUseStoreProductsCache = jest.fn();
const mockReadSmartCart = jest.fn();
const mockWriteSmartCart = jest.fn().mockResolvedValue(undefined);
const mockClearSmartCart = jest.fn().mockResolvedValue(undefined);
const mockCreateInstacartLink = jest.fn();

jest.mock("../../lib/api", () => ({
  useApiClient: () => ({ shopping: { createInstacartLink: mockCreateInstacartLink } }),
}));
jest.mock("../../lib/i18n", () => {
  const { MESSAGE_MAP } = require("@cooking/shared");
  return { useT: () => (key: string) => (
    ["shopping.instacartCreate", "shopping.instacartOpen", "shopping.instacartReady"].includes(key)
      ? MESSAGE_MAP.en[key] : key
  ) };
});

jest.mock("./useSmartShoppingList", () => ({
  useSmartShoppingList: (...args: unknown[]) => mockUseSmartShoppingList(...args),
}));

jest.mock("./useStoreProductsCache", () => ({
  useStoreProductsCache: (...args: unknown[]) => mockUseStoreProductsCache(...args),
}));

jest.mock("./storage", () => ({
  readSmartCart: (...args: unknown[]) => mockReadSmartCart(...args),
  writeSmartCart: (...args: unknown[]) => mockWriteSmartCart(...args),
  clearSmartCart: (...args: unknown[]) => mockClearSmartCart(...args),
}));

const RICE_URL = "https://www.sayweee.com/product/jasmine-rice";
const KALE_URL = "https://www.sayweee.com/product/organic-kale";
const UNSAFE_URL = "https://sayweee.com.evil.test/product/ginger";

const refinedData = {
  remove: [],
  likely_pantry: [],
  purchase_items: [
    { name: "Rice", suggested_purchase: "1 bag", category: "Pantry" },
    { name: "Kale", suggested_purchase: "2 bunches", category: "Produce" },
    { name: "Ginger", suggested_purchase: "1 knob", category: "Produce" },
  ],
};

function readyState(overrides: Record<string, unknown> = {}) {
  const bounds = getWeekBounds("2026-08-10");
  return {
    status: "ready",
    bounds,
    data: {
      items: [],
      mealPlans: [],
      recipeById: {},
      refinedData,
      hidden: new Set<number>(),
      checked: new Set<number>(),
      savedFingerprint: "planner-v1",
      smartListStale: false,
    },
    refining: false,
    refineError: null as string | null,
    ...overrides,
  };
}

function smartResult(state = readyState()) {
  return {
    state,
    refresh: jest.fn(),
    prepareSmartList: jest.fn().mockResolvedValue({
      status: "succeeded",
      weekStart: state.bounds.start,
    }),
    backToOriginal: jest.fn().mockResolvedValue({
      status: "succeeded",
      weekStart: state.bounds.start,
    }),
    toggleChecked: jest.fn(),
    hideItem: jest.fn(),
  };
}

function productsResult(overrides: Record<string, unknown> = {}) {
  return {
    hydrated: true,
    open: { rice: true, kale: true, ginger: true },
    products: {
      rice: [{ name: "Jasmine rice", price: "$2.99", image: "", url: RICE_URL }],
      kale: [{ name: "Organic kale", price: "$4.00", image: "", url: KALE_URL }],
      ginger: [{ name: "Unverified ginger", price: "$1.00", image: "", url: UNSAFE_URL }],
    },
    loading: { rice: false, kale: false, ginger: false },
    errors: { rice: null, kale: null, ginger: null },
    togglePanel: jest.fn(),
    retry: jest.fn().mockResolvedValue(undefined),
    loadAll: jest.fn().mockResolvedValue(undefined),
    openMany: jest.fn(),
    bulkLoading: { active: false, done: 0, total: 0 },
    resetLive: jest.fn(),
    ...overrides,
  };
}

function navigation() {
  return {
    setParams: jest.fn(),
    navigate: jest.fn(),
  };
}

function screenElement(weekStart = "2026-08-10") {
  return (
    <ShoppingListScreen
      navigation={navigation() as never}
      route={{ params: { weekStart } } as never}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadSmartCart.mockResolvedValue({ selectedUrlByIngredient: {}, confirmedTokens: [] });
  mockWriteSmartCart.mockResolvedValue(undefined);
  mockClearSmartCart.mockResolvedValue(undefined);
  mockUseSmartShoppingList.mockReturnValue(smartResult());
  mockUseStoreProductsCache.mockReturnValue(productsResult());
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});

afterEach(() => {
  expect(mockCreateInstacartLink).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

test("original shopping keeps smart-list preparation available without Instacart", async () => {
  const state = readyState();
  const original = {
    ...state,
    data: {
      ...state.data,
      refinedData: null,
      items: [{ name: "Rice", total_quantity: "200 g", checked: false }],
    },
  };
  const hook = smartResult(original as never);
  const products = productsResult();
  mockUseSmartShoppingList.mockReturnValue(hook);
  mockUseStoreProductsCache.mockReturnValue(products);
  await render(screenElement());
  expect(screen.queryByRole("button", { name: /instacart/i })).not.toBeOnTheScreen();
  expect(screen.queryAllByText(/instacart/i)).toHaveLength(0);
  expect(mockCreateInstacartLink).not.toHaveBeenCalled();
  expect(hook.prepareSmartList).not.toHaveBeenCalled();
  expect(products.loadAll).not.toHaveBeenCalled();
  expect(products.togglePanel).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Prepare smart shopping list" })).toBeEnabled();
});

test("smart shopping preserves Weee selection and confirmations without Instacart", async () => {
  const state = readyState();
  state.data.checked = new Set([1]);
  state.data.hidden = new Set([2]);
  const hook = smartResult(state);
  mockUseSmartShoppingList.mockReturnValue(hook);
  await render(screenElement());
  const user = userEvent.setup();
  expect(await screen.findByRole("button", { name: "Review Weee cart · 1" })).toBeOnTheScreen();

  expect(screen.queryByRole("button", { name: /instacart/i })).not.toBeOnTheScreen();
  expect(screen.queryAllByText(/instacart/i)).toHaveLength(0);
  await user.press(screen.getByRole("button", { name: "Review Weee cart · 1" }));
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));
  expect(Linking.openURL).toHaveBeenCalledWith(RICE_URL);
  await user.press(screen.getByRole("button", { name: "Close Weee cart review" }));
  expect(mockCreateInstacartLink).not.toHaveBeenCalled();
  expect(hook.toggleChecked).not.toHaveBeenCalled();
  expect(hook.hideItem).not.toHaveBeenCalled();
  expect(mockClearSmartCart).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Review Weee cart · 1" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Load top picks from Weee" })).toBeOnTheScreen();
});

test.each(["stale", "refining", "route-week-changed"])("%s shopping never exposes Instacart or creates a link", async (scenario) => {
  const state = readyState();
  state.data.smartListStale = scenario === "stale";
  state.refining = scenario === "refining";
  mockUseSmartShoppingList.mockReturnValue(smartResult(state));
  await render(screenElement(scenario === "route-week-changed" ? "2026-08-17" : "2026-08-10"));
  expect(screen.queryByRole("button", { name: /instacart/i })).not.toBeOnTheScreen();
  expect(screen.queryAllByText(/instacart/i)).toHaveLength(0);
  expect(mockCreateInstacartLink).not.toHaveBeenCalled();
});

test("all three Weee choices remain selectable and cart review follows the third then second choice", async () => {
  const state = readyState();
  state.data.refinedData = { ...refinedData, purchase_items: [refinedData.purchase_items[0]] };
  mockUseSmartShoppingList.mockReturnValue(smartResult(state));
  mockUseStoreProductsCache.mockReturnValue(productsResult({
    products: { rice: [
      { name: "First rice", price: "$1.00", image: "", url: RICE_URL },
      { name: "Second rice", price: "$2.00", image: "", url: "https://www.sayweee.com/product/second-rice" },
      { name: "Third rice", price: "$3.00", image: "", url: "https://www.sayweee.com/product/third-rice" },
    ] },
  }));
  await render(screenElement());
  const user = userEvent.setup();
  expect(screen.getAllByRole("radio")).toHaveLength(3);

  await user.press(screen.getByRole("radio", { name: "Choose Third rice for cart" }));
  expect(screen.getByRole("radio", { name: "Third rice: Selected for cart" }))
    .toHaveProp("accessibilityState", { selected: true });
  await user.press(screen.getByRole("button", { name: "Review Weee cart · 1" }));
  expect(screen.getByText("Estimated subtotal: $3.00")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));
  expect(Linking.openURL).toHaveBeenLastCalledWith("https://www.sayweee.com/product/third-rice");
  await user.press(screen.getByRole("button", { name: "Close Weee cart review" }));

  await user.press(screen.getByRole("radio", { name: "Choose Second rice for cart" }));
  expect(screen.getByRole("radio", { name: "Second rice: Selected for cart" }))
    .toHaveProp("accessibilityState", { selected: true });
  await user.press(screen.getByRole("button", { name: "Review Weee cart · 1" }));
  expect(screen.getByText("Estimated subtotal: $2.00")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));
  expect(Linking.openURL).toHaveBeenLastCalledWith("https://www.sayweee.com/product/second-rice");
});

test("derives authoritative product state by own-key and excludes checked or hidden rows", () => {
  const loadedProducts = [
    { name: "Loaded product", price: "$1.00", image: "", url: RICE_URL },
  ];
  const ingredients = buildMobileCartIngredients(
    {
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Loaded", suggested_purchase: "1", category: "Other" },
        { name: "Empty", suggested_purchase: "2", category: "Other" },
        { name: "Errored", suggested_purchase: "3", category: "Other" },
        { name: "Pending", suggested_purchase: "4", category: "Other" },
        { name: "Loading", suggested_purchase: "5", category: "Other" },
        { name: "Checked", suggested_purchase: "6", category: "Other" },
        { name: "Hidden", suggested_purchase: "7", category: "Other" },
      ],
    },
    new Set([6]),
    new Set([5]),
    {
      hydrated: true,
      products: {
        loaded: loadedProducts,
        empty: [],
        errored: loadedProducts,
        loading: [],
      },
      loading: { loading: true },
      errors: { errored: "Could not load products" },
    },
  );

  expect(ingredients).not.toBeNull();
  expect(ingredients?.map(({ key }) => key)).toEqual([
    "loaded",
    "empty",
    "errored",
    "pending",
    "loading",
  ]);
  expect(ingredients?.map(({ productsSettled, productsPending }) => ({
    productsSettled,
    productsPending,
  }))).toEqual([
    { productsSettled: true, productsPending: false },
    { productsSettled: true, productsPending: false },
    { productsSettled: true, productsPending: false },
    { productsSettled: false, productsPending: false },
    { productsSettled: false, productsPending: true },
  ]);
  expect(ingredients?.[0].products).toBe(loadedProducts);
  expect(ingredients?.[1].products).toEqual([]);
  expect(ingredients?.[2].products).toEqual([]);
  expect(buildMobileCartIngredients(null, new Set(), new Set(), {
    hydrated: true, products: {}, loading: {}, errors: {},
  })).toBeNull();
});

test("waits for current-week product-cache hydration before exposing cart authority", () => {
  expect(buildMobileCartIngredients(
    refinedData,
    new Set(),
    new Set(),
    { hydrated: false, products: {}, loading: {}, errors: {} },
  )).toBeNull();
});

test("deduplicates canonical ingredient keys after checked and hidden eligibility", () => {
  const riceProducts = [{ name: "Rice", price: "$2.99", image: "", url: RICE_URL }];
  const kaleProducts = [{ name: "Kale", price: "$4.00", image: "", url: KALE_URL }];

  const ingredients = buildMobileCartIngredients(
    {
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: " Rice ", suggested_purchase: "hidden first", category: "Pantry" },
        { name: "Rice", suggested_purchase: "first eligible rice", category: "Pantry" },
        { name: " rice ", suggested_purchase: "duplicate rice", category: "Pantry" },
        { name: "KALE", suggested_purchase: "checked first", category: "Produce" },
        { name: "kale", suggested_purchase: "first eligible kale", category: "Produce" },
      ],
    },
    new Set([0]),
    new Set([3]),
    {
      hydrated: true,
      products: { rice: riceProducts, kale: kaleProducts },
      loading: { rice: false, kale: false },
      errors: { rice: null, kale: null },
    },
  );

  expect(ingredients?.map(({ key, name, suggestedPurchase }) => ({
    key,
    name,
    suggestedPurchase,
  }))).toEqual([
    { key: "rice", name: "Rice", suggestedPurchase: "first eligible rice" },
    { key: "kale", name: "kale", suggestedPurchase: "first eligible kale" },
  ]);
});

test("treats a persisted null error without products as idle expired-unknown authority", () => {
  const ingredients = buildMobileCartIngredients(
    {
      remove: [],
      likely_pantry: [],
      purchase_items: [
        { name: "Rice", suggested_purchase: "1 bag", category: "Pantry" },
      ],
    },
    new Set(),
    new Set(),
    {
      hydrated: true,
      products: {},
      loading: { rice: false },
      errors: { rice: null },
    },
  );

  expect(ingredients).toEqual([{
    key: "rice",
    name: "Rice",
    suggestedPurchase: "1 bag",
    products: [],
    productsSettled: false,
    productsPending: false,
  }]);
});

test("opens only the safe current selection and catches opener rejection", async () => {
  const draft = buildCartAssistantDraft({
    ingredients: [{
      key: "rice",
      name: "Rice",
      suggestedPurchase: "1 bag",
      products: [{ name: "Rice", price: "$2.99", image: "", url: RICE_URL }],
    }],
    selectedUrlByIngredient: {},
    confirmedTokens: new Set(),
  });
  const openUrl = jest.fn().mockResolvedValue(undefined);
  const token = draft.selections[0].confirmationToken;

  await expect(openCurrentCartProduct({
    draft,
    skippedTokens: new Set(),
    confirmationToken: token,
    productUrl: RICE_URL,
    openUrl,
  })).resolves.toBe(true);
  expect(openUrl).toHaveBeenCalledTimes(1);

  await expect(openCurrentCartProduct({
    draft,
    skippedTokens: new Set(),
    confirmationToken: "stale-token",
    productUrl: UNSAFE_URL,
    openUrl,
  })).resolves.toBe(false);
  expect(openUrl).toHaveBeenCalledTimes(1);

  openUrl.mockRejectedValueOnce(new Error("link denied"));
  await expect(openCurrentCartProduct({
    draft,
    skippedTokens: new Set(),
    confirmationToken: token,
    productUrl: RICE_URL,
    openUrl,
  })).resolves.toBe(false);
  expect(openUrl).toHaveBeenCalledTimes(2);
});

test("reviews real shopping rows, opens one safe product, confirms, undoes, and resets skips on reopen", async () => {
  const cache = productsResult();
  mockUseStoreProductsCache.mockReturnValue(cache);
  await render(screenElement());
  const user = userEvent.setup();

  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 2" }));
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
  expect(screen.getByText("Ginger — 1 knob")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledTimes(1));
  expect(Linking.openURL).toHaveBeenCalledWith(RICE_URL);
  expect(Linking.openURL).not.toHaveBeenCalledWith(UNSAFE_URL);

  await user.press(screen.getByRole("button", { name: "I added it" }));
  expect(await screen.findByText("Next: Kale")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Undo Rice" }));
  expect(await screen.findByText("Next: Rice")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Skip for now" }));
  expect(await screen.findByText("Next: Kale")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Close Weee cart review" }));
  await user.press(screen.getByRole("button", { name: "Review Weee cart · 2" }));
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Find a match for Ginger" }));
  expect(cache.openMany).toHaveBeenCalledWith(["Ginger"]);
  expect(cache.retry).toHaveBeenCalledWith("Ginger");
});

test("does not offer cart review when every settled result is empty or unsafe", async () => {
  mockUseStoreProductsCache.mockReturnValue(productsResult({
    products: {
      rice: [],
      kale: [],
      ginger: [{ name: "Unverified ginger", price: "$1.00", image: "", url: UNSAFE_URL }],
    },
  }));

  await render(screenElement());

  expect(screen.queryByRole("button", { name: /Review Weee cart/ })).not.toBeOnTheScreen();
});

test("a manual match leaves hydrated never-requested rows unmatched instead of pending forever", async () => {
  mockUseStoreProductsCache.mockReturnValue(productsResult({
    open: { rice: true },
    products: {
      rice: [{ name: "Jasmine rice", price: "$2.99", image: "", url: RICE_URL }],
    },
    loading: { rice: false },
    errors: { rice: null },
  }));
  await render(screenElement());
  const user = userEvent.setup();

  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 1" }));
  expect(screen.getByText("2 unmatched")).toBeOnTheScreen();
  expect(screen.queryByText(/finding match/i)).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "I added it" }));
  expect(await screen.findByText("Handoff complete")).toBeOnTheScreen();
});

test("opens the exact Weee home URL for final review and keeps a rejected handoff retryable", async () => {
  (Linking.openURL as jest.MockedFunction<typeof Linking.openURL>)
    .mockRejectedValueOnce(new Error("link denied"));
  await render(screenElement());
  const user = userEvent.setup();

  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 2" }));
  await user.press(screen.getByRole("button", { name: "I added it" }));
  await user.press(await screen.findByRole("button", { name: "I added it" }));
  await user.press(await screen.findByRole("button", { name: "Open Weee for final review" }));

  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("https://www.sayweee.com/"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't open Weee. Try again when you're ready.",
  );
  expect(screen.getByRole("button", { name: "Open Weee for final review" })).toBeOnTheScreen();
});

test("resets and closes cart progress after a successful smart-list regeneration", async () => {
  const base = readyState();
  const result = smartResult({
    ...base,
    data: { ...base.data, smartListStale: true },
  });
  const cache = productsResult();
  mockUseSmartShoppingList.mockReturnValue(result);
  mockUseStoreProductsCache.mockReturnValue(cache);
  await render(screenElement());
  const user = userEvent.setup();
  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 2" }));
  await user.press(screen.getByRole("button", { name: "I added it" }));
  await user.press(screen.getByRole("button", { name: "Refresh smart list" }));

  await waitFor(() => expect(result.prepareSmartList).toHaveBeenCalledTimes(1));
  expect(cache.resetLive).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mockClearSmartCart).toHaveBeenCalledWith("2026-08-10"));
  expect(screen.queryByText("Review Weee cart")).not.toBeOnTheScreen();
});

test("does not clear or close cart progress when regeneration fails", async () => {
  const base = readyState();
  const result = smartResult({
    ...base,
    data: { ...base.data, smartListStale: true },
  });
  result.prepareSmartList.mockResolvedValue({
    status: "failed",
    weekStart: "2026-08-10",
    error: "Refine failed",
  });
  const cache = productsResult();
  mockUseSmartShoppingList.mockReturnValue(result);
  mockUseStoreProductsCache.mockReturnValue(cache);
  await render(screenElement());
  const user = userEvent.setup();
  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 2" }));
  await user.press(screen.getByRole("button", { name: "Refresh smart list" }));

  await waitFor(() => expect(result.prepareSmartList).toHaveBeenCalledTimes(1));
  expect(cache.resetLive).not.toHaveBeenCalled();
  expect(mockClearSmartCart).not.toHaveBeenCalled();
  expect(screen.getByText("Review Weee cart")).toBeOnTheScreen();
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
});

test("back to original clears cart state only after the transition succeeds", async () => {
  const result = smartResult();
  mockUseSmartShoppingList.mockReturnValue(result);
  await render(screenElement());
  const user = userEvent.setup();
  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 2" }));
  await user.press(screen.getByRole("button", { name: "Back to original" }));

  await waitFor(() => expect(result.backToOriginal).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockClearSmartCart).toHaveBeenCalledWith("2026-08-10"));
  expect(screen.queryByText("Review Weee cart")).not.toBeOnTheScreen();
});

test("the empty-list back action uses the same successful cart reset", async () => {
  const base = readyState();
  const result = smartResult({
    ...base,
    data: { ...base.data, hidden: new Set([0, 1, 2]) },
  });
  mockUseSmartShoppingList.mockReturnValue(result);
  await render(screenElement());
  const user = userEvent.setup();
  const backButtons = screen.getAllByRole("button", { name: "Back to original" });

  await user.press(backButtons[backButtons.length - 1]);

  await waitFor(() => expect(result.backToOriginal).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockClearSmartCart).toHaveBeenCalledWith("2026-08-10"));
});

test("keeps the cart review open when back-to-original does not complete", async () => {
  const result = smartResult();
  result.backToOriginal.mockResolvedValue({
    status: "failed",
    weekStart: "2026-08-10",
    error: "storage denied",
  });
  const cache = productsResult();
  mockUseSmartShoppingList.mockReturnValue(result);
  mockUseStoreProductsCache.mockReturnValue(cache);
  await render(screenElement());
  const user = userEvent.setup();
  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 2" }));
  await user.press(screen.getByRole("button", { name: "Back to original" }));

  await waitFor(() => expect(result.backToOriginal).toHaveBeenCalledTimes(1));
  expect(cache.resetLive).not.toHaveBeenCalled();
  expect(mockClearSmartCart).not.toHaveBeenCalled();
  expect(screen.getByText("Review Weee cart")).toBeOnTheScreen();
});

test("closes review and clears only session skips when the week changes", async () => {
  let current = smartResult();
  mockUseSmartShoppingList.mockImplementation(() => current);
  const rendered = await render(screenElement());
  const user = userEvent.setup();
  await user.press(await screen.findByRole("button", { name: "Review Weee cart · 2" }));
  await user.press(screen.getByRole("button", { name: "Skip for now" }));
  expect(await screen.findByText("Next: Kale")).toBeOnTheScreen();

  current = smartResult({ ...current.state, bounds: getWeekBounds("2026-08-17") });
  await rendered.rerender(screenElement("2026-08-17"));

  await waitFor(() => expect(screen.queryByText("Review Weee cart")).not.toBeOnTheScreen());
  expect(mockClearSmartCart).not.toHaveBeenCalled();
  await user.press(screen.getByRole("button", { name: "Review Weee cart · 2" }));
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
});
