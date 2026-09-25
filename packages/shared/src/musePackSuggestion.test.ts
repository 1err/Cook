import { expect, test } from "vitest";
import { getMusePackSuggestion } from "./musePackSuggestion";

function item(productName: string, amounts: string[], hasConfirmedMatch = false) {
  return {
    product: { name: productName, price: "$3.49", image: "", url: "https://www.sayweee.com/product/rice" },
    ingredients: amounts.map((suggestedPurchase, index) => ({ name: `Ingredient ${index + 1}`, suggestedPurchase })),
    hasConfirmedMatch,
  };
}

test("recommends enough packs and explains the total and spare amount", () => {
  expect(getMusePackSuggestion(item("Jasmine Rice 350 g", ["600 g"]))).toEqual({
    status: "suggested", packs: 2,
    requiredAmount: "600 g", packageAmount: "350 g", totalAmount: "700 g", leftoverAmount: "100 g",
  });
});

test.each([
  ["牛肉 2磅", "500g", 1, "907.18 g"],
  ["牛肉 16盎司", "600g", 2, "453.59 g"],
  ["Beef 8 oz", "1磅", 2, "226.8 g"],
  ["Beef 1 lb", "24盎司", 2, "453.59 g"],
])("matches explicit Chinese mass labels to compatible needs: %s", (name, needed, packs, packageAmount) => {
  expect(getMusePackSuggestion(item(name, [needed]))).toMatchObject({
    status: "suggested", packs, packageAmount,
  });
});

test.each(["牛肉 约2磅", "牛肉 1–2磅", "牛肉 16盎司-1磅", "牛肉 16盎司至1磅", "牛肉 16盎司～1磅", "牛肉 2斤"])(
  "abstains from approximate, ranged, or unsupported Chinese mass labels: %s",
  (name) => expect(getMusePackSuggestion(item(name, ["500g"]))).toEqual({ status: "unavailable", reason: "package-size" }),
);

test.each(["饮料 16液盎司", "饮料 16液体盎司", "饮料 液体盎司规格 16盎司", "饮料 16盎司（液量盎司）", "饮料 液量盎司规格 16盎司", "饮料 16盎司（液 量 盎司）"])(
  "does not reinterpret Chinese fluid ounce labels as mass: %s",
  (name) => expect(getMusePackSuggestion(item(name, ["500g"]))).toEqual({ status: "unavailable", reason: "package-size" }),
);

test.each(["16液盎司", "16液体盎司"])("does not reinterpret Chinese fluid ounce needs as mass: %s", (needed) => {
  expect(getMusePackSuggestion(item("Beef 1lb", [needed]))).toEqual({ status: "unavailable", reason: "ingredient-amount" });
});

test("sums all ingredient needs before rounding a shared product to packs", () => {
  expect(getMusePackSuggestion(item("Rice 350g", ["100 g", "100 g"]))).toEqual({
    status: "suggested", packs: 1,
    requiredAmount: "200 g", packageAmount: "350 g", totalAmount: "350 g", leftoverAmount: "150 g",
  });
});

test.each([
  ["Rice 0.5 kg", ["750 g"], 2, "750 g", "500 g", "250 g"],
  ["Rice 8 oz", ["1 lb"], 2, "453.59 g", "226.8 g", "0 g"],
  ["Rice 1 lb", ["1000 g"], 3, "1000 g", "453.59 g", "360.78 g"],
  ["Milk 500 ml", ["1 l", "250 ml"], 3, "1250 ml", "500 ml", "250 ml"],
  ["Juice 8 fl oz", ["1 cup"], 1, "236.59 ml", "236.59 ml", "0 ml"],
  ["Oil 20ml", ["1 tbsp", "1 tsp"], 1, "19.72 ml", "20 ml", "0.28 ml"],
  ["Eggs 12 count", ["6", "8 pieces"], 2, "14 items", "12 items", "10 items"],
  ["Eggs 1 dozen", ["18 eggs"], 2, "18 items", "12 items", "6 items"],
  ["Juice 2 bottles", ["3 bottles"], 2, "3 bottles", "2 bottles", "1 bottle"],
  ["大米 350克", ["0.6公斤"], 2, "600 g", "350 g", "100 g"],
] as const)("converts compatible units for %s", (name, amounts, packs, requiredAmount, packageAmount, leftoverAmount) => {
  expect(getMusePackSuggestion(item(name, [...amounts]))).toMatchObject({
    status: "suggested", packs, requiredAmount, packageAmount, leftoverAmount,
  });
});

test.each([
  ["Rice 1/2 lb", "1 1/2 lb", 3],
  ["Milk ½ l", "1½ l", 3],
  ["Rice 0.25 kg", "¾ kg", 3],
  ["Milk 500ml", "⅓ l", 1],
  ["Rice 350g", "700g", 2],
])("supports explicit fractions without inventing extra packs: %s / %s", (name, need, packs) => {
  expect(getMusePackSuggestion(item(name, [need]))).toMatchObject({ status: "suggested", packs });
});

test.each([
  "Rice 2 x 350 g",
  "Rice 350g × 2",
  "Rice 2-pack (350 g each)",
  "Rice Pack of 2, 350g each",
])("uses the full purchasable multipack amount: %s", (name) => {
  expect(getMusePackSuggestion(item(name, ["1200g"]))).toEqual({
    status: "suggested", packs: 2,
    requiredAmount: "1200 g", packageAmount: "700 g", totalAmount: "1400 g", leftoverAmount: "200 g",
  });
});

test("uses equivalent dual labels once and conservatively chooses the smaller labelled package size", () => {
  expect(getMusePackSuggestion(item("Tofu 12 oz (340 g)", ["600 g"]))).toEqual({
    status: "suggested", packs: 2,
    requiredAmount: "600 g", packageAmount: "340 g", totalAmount: "680 g", leftoverAmount: "80 g",
  });
});

test.each([
  ["Eggs 99ct (100 pieces)", "150 eggs"],
  ["Rice 350g (352g)", "600g"],
])("does not treat conflicting counts or same-unit sizes as rounded dual labels: %s", (name, amount) => {
  expect(getMusePackSuggestion(item(name, [amount]))).toEqual({ status: "unavailable", reason: "package-size" });
});

test("chooses the matching dimension when a product explicitly supplies both mass and item count", () => {
  expect(getMusePackSuggestion(item("Eggs 12 ct, 600 g", ["8 eggs"]))).toMatchObject({ status: "suggested", packs: 1, packageAmount: "12 items" });
  expect(getMusePackSuggestion(item("Eggs 12 ct, 600 g", ["900 g"]))).toMatchObject({ status: "suggested", packs: 2, packageAmount: "600 g" });
});

test.each(["Organic rice", "Rice 0g", "Rice -350g", "Rice ~350g", "Rice about 350g", "Rice 350-400g", "Rice 1–1.5 lb", "Rice 350g or 700g", "Rice 350g (500g)", "Rice 2 pack 350g", "Rice 2 x 3 x 350g", "Rice 350g x 2 x 3", "Rice 350g x 2g", "Rice 10g protein"])(
  "does not infer an ambiguous package size from %s",
  (name) => expect(getMusePackSuggestion(item(name, ["600g"]))).toEqual({ status: "unavailable", reason: "package-size" }),
);

test.each(["", "a little", "0g", "-500g", "500-600g", "500 g, 1 kg", "500g + 500g", "500g or 1kg", "about 500g", "500g extra", "1/0 kg"])(
  "does not silently discard ambiguous or invalid ingredient amounts %j",
  (amount) => expect(getMusePackSuggestion(item("Rice 350g", [amount]))).toEqual({ status: "unavailable", reason: "ingredient-amount" }),
);

test.each([
  ["Rice 1 lb", ["2 cups"]],
  ["Milk 1 l", ["500 g"]],
  ["Rice 350g", ["1 bag"]],
  ["Juice 2 bottles", ["3 cans"]],
  ["Rice 350g", ["100g", "1 cup"]],
] as const)("refuses density conversions or incompatible counts for %s", (name, amounts) => {
  expect(getMusePackSuggestion(item(name, [...amounts]))).toEqual({ status: "unavailable", reason: "unit-mismatch" });
});

test("refuses an incomplete set of grouped needs", () => {
  expect(getMusePackSuggestion(item("Rice 350g", ["100g", "some"]))).toEqual({ status: "unavailable", reason: "ingredient-amount" });
  expect(getMusePackSuggestion(item("Rice 350g", []))).toEqual({ status: "unavailable", reason: "ingredient-amount" });
});

test("abstains where confirmed ingredients sharing this product were omitted from the total", () => {
  expect(getMusePackSuggestion(item("Rice 350g", ["350g"], true))).toEqual({ status: "unavailable", reason: "already-added" });
});

test("keeps pack suggestions within the handoff limit and accepts the exact boundary", () => {
  expect(getMusePackSuggestion(item("Rice 1g", ["99g"]))).toMatchObject({ status: "suggested", packs: 99 });
  expect(getMusePackSuggestion(item("Rice 1g", ["100g"]))).toEqual({ status: "unavailable", reason: "too-many-packs" });
});

test("renders count amounts for Chinese and leaves the supplied item unchanged", () => {
  const input = item("Eggs 12 count", ["18 eggs"]);
  const before = structuredClone(input);
  expect(getMusePackSuggestion(input, "zh")).toMatchObject({ status: "suggested", requiredAmount: "18 个", packageAmount: "12 个", leftoverAmount: "6 个" });
  expect(input).toEqual(before);
});

test("uses an explicit customer supplied package size when the title has none or differs", () => {
  expect(getMusePackSuggestion(item("Premium rice", ["600g"]), "en", "350 g")).toMatchObject({ status: "suggested", packs: 2, packageAmount: "350 g" });
  expect(getMusePackSuggestion(item("Rice 1kg", ["600g"]), "en", "2 x 350g")).toMatchObject({ status: "suggested", packs: 1, packageAmount: "700 g" });
  expect(getMusePackSuggestion(item("Rice", ["600g"]), "en", "350ml")).toEqual({ status: "unavailable", reason: "unit-mismatch" });
});

test.each(["350", "350g extra", "$3.50 350g", "350g or 700g", "Rice 350g"])("requires the entire supplied package size to be explicit: %s", (size) => {
  expect(getMusePackSuggestion(item("Rice 1kg", ["600g"]), "en", size)).toEqual({ status: "unavailable", reason: "package-size" });
});

test("reports the missing package size first so customers can supply it", () => {
  expect(getMusePackSuggestion(item("Rice", ["1 bag"]))).toEqual({ status: "unavailable", reason: "package-size" });
});

test("rejects comma joined aggregation fragments even when their amounts are equivalent", () => {
  expect(getMusePackSuggestion(item("Rice 500g", ["500g, 0.5kg"]))).toEqual({ status: "unavailable", reason: "ingredient-amount" });
});

test.each(["Protein powder 20g per serving", "Snack 10g fiber", "Snack 10g fibre", "每份100克", "大米约500克", "Rice avg 500g", "Protein10g", "Rice case of 6 350g", "Rice 6pk 350g"])("rejects nutrition, approximate, and ambiguous packaging labels: %s", (name) => {
  expect(getMusePackSuggestion(item(name, ["600g"]))).toEqual({ status: "unavailable", reason: "package-size" });
});

test.each([
  ["Juice6bottles350ml", "600ml"],
  ["Rice2bags500g", "2kg"],
  ["Juice6pk350ml", "600ml"],
  ["Protein powder20g of protein per serving", "600g"],
])("abstains from ambiguous containers and compact or nutritional quantities: %s", (name, amount) => {
  expect(getMusePackSuggestion(item(name, [amount]))).toEqual({ status: "unavailable", reason: "package-size" });
});

test.each([
  ["Juice 6 bottles 1L each", "6L", 1, "6000 ml"],
  ["Tomato 6 cans 400g each", "2000g", 1, "2400 g"],
  ["Yogurt 6ct 100g each", "2000g", 4, "600 g"],
  ["Rice 4x100g", "700g", 2, "400 g"],
  ["Rice 100g x4", "700g", 2, "400 g"],
  ["Premium Rice10lb", "5lb", 1, "4535.92 g"],
] as const)("handles explicit adjacent quantities or count and each packaging: %s", (name, needed, packs, packageAmount) => {
  expect(getMusePackSuggestion(item(name, [needed]))).toMatchObject({ status: "suggested", packs, packageAmount });
});
