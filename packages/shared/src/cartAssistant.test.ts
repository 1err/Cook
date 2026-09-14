import { expect, test } from "vitest";
import {
  buildCartAssistantDraft,
  cartConfirmationToken,
  parseCartPriceCents,
  type CartAssistantProduct,
} from "./cartAssistant";

const riceA: CartAssistantProduct = {
  name: "Weee! Jasmine Rice",
  price: "$12.99",
  image: "https://img.sayweee.com/rice-a.jpg",
  url: "https://www.sayweee.com/en/product/Weee-Jasmine-Rice/10001",
};

const riceB: CartAssistantProduct = {
  name: "Weee! Brown Rice",
  price: "$14.99",
  image: "https://img.sayweee.com/rice-b.jpg",
  url: "https://www.sayweee.com/en/product/Weee-Brown-Rice/10002",
};

test("selects the first safe product when no explicit choice exists", () => {
  const draft = buildCartAssistantDraft({
    ingredients: [{ key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [riceA, riceB] }],
    selectedUrlByIngredient: {},
    confirmedTokens: new Set(),
  });

  expect(draft.selections[0].product.url).toBe(riceA.url);
});

test("honors an available safe explicit choice", () => {
  const draft = buildCartAssistantDraft({
    ingredients: [{ key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [riceA, riceB] }],
    selectedUrlByIngredient: { rice: riceB.url },
    confirmedTokens: new Set(),
  });

  expect(draft.selections[0].product.url).toBe(riceB.url);
});

test("falls back when the explicit URL is unsafe or no longer returned", () => {
  const unsafeDraft = buildCartAssistantDraft({
    ingredients: [{ key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [riceA, riceB] }],
    selectedUrlByIngredient: { rice: "https://example.com/product/rice" },
    confirmedTokens: new Set(),
  });
  const unavailableDraft = buildCartAssistantDraft({
    ingredients: [{ key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [riceA] }],
    selectedUrlByIngredient: { rice: riceB.url },
    confirmedTokens: new Set(),
  });

  expect(unsafeDraft.selections[0].product.url).toBe(riceA.url);
  expect(unavailableDraft.selections[0].product.url).toBe(riceA.url);
});

test("excludes unsafe candidate products before choosing the first safe result", () => {
  const unsafeRice: CartAssistantProduct = {
    ...riceA,
    name: "Unsafe Rice",
    url: "https://example.com/product/rice",
  };
  const draft = buildCartAssistantDraft({
    ingredients: [
      { key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [unsafeRice, riceA] },
    ],
    selectedUrlByIngredient: {},
    confirmedTokens: new Set(),
  });

  expect(draft.selections).toHaveLength(1);
  expect(draft.selections[0].product.url).toBe(riceA.url);
});

test("reports empty and unsafe-only product results as unmatched", () => {
  const unsafeRice: CartAssistantProduct = {
    ...riceA,
    name: "Unsafe Rice",
    url: "https://example.com/product/rice",
  };
  const draft = buildCartAssistantDraft({
    ingredients: [
      { key: "no-results", name: "Mushrooms", suggestedPurchase: "8 oz", products: [] },
      {
        key: "unsafe-only",
        name: "Seaweed",
        suggestedPurchase: "1 pack",
        products: [unsafeRice],
      },
    ],
    selectedUrlByIngredient: {},
    confirmedTokens: new Set(),
  });

  expect(draft.selections).toEqual([]);
  expect(draft.unmatched).toEqual([
    { key: "no-results", name: "Mushrooms", suggestedPurchase: "8 oz" },
    { key: "unsafe-only", name: "Seaweed", suggestedPurchase: "1 pack" },
  ]);
  expect(draft.summary).toEqual({
    readyCount: 0,
    unmatchedCount: 2,
    confirmedCount: 0,
    remainingCount: 0,
    estimatedSubtotalCents: 0,
    unpricedCount: 0,
  });
});

test("limits choices to three safe candidates without mutating the ingredients", () => {
  const riceC = { ...riceA, name: "Rice C", url: "https://www.sayweee.com/en/product/Rice-C/10003" };
  const riceD = { ...riceA, name: "Rice D", url: "https://www.sayweee.com/en/product/Rice-D/10004" };
  const ingredients = [
    { key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [riceA, riceB, riceC, riceD] },
  ];
  const before = structuredClone(ingredients);

  const draft = buildCartAssistantDraft({
    ingredients,
    selectedUrlByIngredient: { rice: riceD.url },
    confirmedTokens: new Set(),
  });

  expect(draft.selections[0].product.url).toBe(riceA.url);
  expect(ingredients).toEqual(before);
});

test("parses only standalone US-dollar prices", () => {
  expect(parseCartPriceCents("$2.99")).toBe(299);
  expect(parseCartPriceCents("US$12")).toBe(1200);
  expect(parseCartPriceCents("$2.99-$4.99")).toBeNull();
  expect(parseCartPriceCents("2 for $5")).toBeNull();
  expect(parseCartPriceCents("$3.99 $5.99")).toBeNull();
  expect(parseCartPriceCents("€2.99")).toBeNull();
  expect(parseCartPriceCents("")).toBeNull();
  expect(parseCartPriceCents("price is $2.99 today")).toBeNull();
});

test("sums parseable prices and binds confirmation to the selected product URL", () => {
  const tofu: CartAssistantProduct = {
    name: "Tofu",
    price: "US$12",
    image: "https://img.sayweee.com/tofu.jpg",
    url: "https://www.sayweee.com/en/product/Tofu/10003",
  };
  const sauce: CartAssistantProduct = {
    name: "Sauce",
    price: "2 for $5",
    image: "https://img.sayweee.com/sauce.jpg",
    url: "https://www.sayweee.com/en/product/Sauce/10004",
  };
  const riceToken = cartConfirmationToken("rice", riceA.url);
  const draft = buildCartAssistantDraft({
    ingredients: [
      { key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [riceA, riceB] },
      { key: "tofu", name: "Tofu", suggestedPurchase: "2 packs", products: [tofu] },
      { key: "sauce", name: "Sauce", suggestedPurchase: "1 jar", products: [sauce] },
    ],
    selectedUrlByIngredient: { rice: riceA.url },
    confirmedTokens: new Set([riceToken]),
  });

  expect(cartConfirmationToken("rice", riceB.url)).not.toBe(riceToken);
  expect(draft.selections[0].confirmed).toBe(true);
  expect(draft.summary).toEqual({
    readyCount: 3,
    unmatchedCount: 0,
    confirmedCount: 1,
    remainingCount: 2,
    estimatedSubtotalCents: 2499,
    unpricedCount: 1,
  });
});
