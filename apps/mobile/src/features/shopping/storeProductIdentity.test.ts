import {
  canonicalStoreProductKey,
  cleanStoreProductQuery,
  prepareStoreProductQueries,
} from "./storeProductIdentity";

test("prepares one first-spelling query for each mechanical identity", () => {
  expect(prepareStoreProductQueries([" Rice ", "rice", "two  cloves garlic", " "])).toEqual([
    { key: "rice", query: "Rice" },
    { key: "two cloves garlic", query: "two cloves garlic" },
  ]);
});

test("only trims, collapses whitespace, and lowercases UI identity", () => {
  expect(cleanStoreProductQuery("  Jasmine   Rice  ")).toBe("Jasmine Rice");
  expect(canonicalStoreProductKey("  JASMINE   RICE  ")).toBe("jasmine rice");
});
