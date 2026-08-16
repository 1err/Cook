import type { StoreProduct } from "@cooking/api-client";
import { parseSmartProductsStored } from "./storage";

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
  });
});
