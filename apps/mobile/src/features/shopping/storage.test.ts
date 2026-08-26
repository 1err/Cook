import type { StoreProduct } from "@cooking/api-client";
import { isFreshStoredProductResponse, parseSmartProductsStored } from "./storage";

jest.mock("../../lib/storage", () => ({
  ephemeral: {},
  json: {},
}));

const product: StoreProduct = {
  name: "Rice",
  price: "$2.99",
  image: "",
  url: "https://www.sayweee.com/product/rice",
};

test("keeps only persisted positives with a valid authoritative future expiry", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");

  expect(
    parseSmartProductsStored(
      {
        open: { fresh: true, exact: true, missing: true },
        products: {
          fresh: {
            products: [product],
            expires_at: "2026-08-15T12:00:00.001Z",
          },
          exact: {
            products: [product],
            expires_at: "2026-08-15T12:00:00.000Z",
          },
          missing: { products: [product] },
        },
        errors: {},
      },
      now,
    ),
  ).toEqual({
    open: { fresh: true, exact: true, missing: true },
    products: {
      fresh: {
        products: [product],
        expires_at: "2026-08-15T12:00:00.001Z",
      },
    },
    errors: {},
    queries: {},
  });
});

test("accepts stored positives only strictly before their authoritative expiry", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");

  expect(
    isFreshStoredProductResponse(
      { products: [product], expires_at: "2026-08-15T12:00:00.001Z" },
      now,
    ),
  ).toBe(true);
  expect(
    isFreshStoredProductResponse(
      { products: [product], expires_at: "2026-08-15T12:00:00.000Z" },
      now,
    ),
  ).toBe(false);
});

test("caps persisted choices and retains valid canonical query metadata", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const products = [
    product,
    { ...product, name: "Beans", url: "https://www.sayweee.com/product/beans" },
    { ...product, name: "Milk", url: "https://www.sayweee.com/product/milk" },
    { ...product, name: "Tofu", url: "https://www.sayweee.com/product/tofu" },
  ];

  expect(
    parseSmartProductsStored(
      {
        open: { Rice: true },
        products: { Rice: { products, expires_at: "2026-08-15T12:00:00.001Z" } },
        errors: {},
        queries: { Rice: "RICE", unknown: "Unknown" },
      },
      now,
    ),
  ).toEqual({
    open: { rice: true },
    products: { rice: { products: products.slice(0, 3), expires_at: "2026-08-15T12:00:00.001Z" } },
    errors: {},
    queries: { rice: "RICE", unknown: "Unknown" },
  });
});

test("parses legacy product payloads without query metadata", () => {
  expect(
    parseSmartProductsStored({ open: {}, products: {}, errors: {} }),
  ).toEqual({ open: {}, products: {}, errors: {}, queries: {} });
});
