import type { StoreProduct } from "@cooking/api-client";
import { waitFor } from "@testing-library/react-native";
import {
  clearSmartCart,
  isFreshStoredProductResponse,
  parseSmartCartStored,
  parseSmartProductsStored,
  readSmartCart,
  smartCartKey,
  writeSmartCart,
} from "./storage";

const mockEphemeralRemove = jest.fn().mockResolvedValue(undefined);
const mockJsonGet = jest.fn();
const mockJsonSet = jest.fn().mockResolvedValue(undefined);

jest.mock("../../lib/storage", () => ({
  ephemeral: {
    remove: (...args: unknown[]) => mockEphemeralRemove(...args),
  },
  json: {
    get: (...args: unknown[]) => mockJsonGet(...args),
    set: (...args: unknown[]) => mockJsonSet(...args),
  },
}));

const product: StoreProduct = {
  name: "Rice",
  price: "$2.99",
  image: "",
  url: "https://www.sayweee.com/product/rice",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockEphemeralRemove.mockReset().mockResolvedValue(undefined);
  mockJsonGet.mockReset().mockResolvedValue(null);
  mockJsonSet.mockReset().mockResolvedValue(undefined);
});

test("uses the exact week-scoped Weee smart-cart key", () => {
  expect(smartCartKey("2026-08-10")).toBe("smartShoppingCart:2026-08-10:weee");
});

test("sanitizes unknown smart-cart data, canonicalizes keys, and keeps the first safe URL", () => {
  expect(
    parseSmartCartStored({
      selectedUrlByIngredient: {
        " Jasmine   Rice ": "https://www.sayweee.com/product/first-rice",
        "JASMINE RICE": "https://www.sayweee.com/product/later-rice",
        " rice ": "https://example.com/product/unsafe-rice",
        "": "https://www.sayweee.com/product/empty",
        tofu: 42,
      },
      confirmedTokens: [
        '["jasmine rice","https://www.sayweee.com/product/first-rice"]',
        "",
        7,
        null,
      ],
    }),
  ).toEqual({
    selectedUrlByIngredient: {
      "jasmine rice": "https://www.sayweee.com/product/first-rice",
    },
    confirmedTokens: [
      '["jasmine rice","https://www.sayweee.com/product/first-rice"]',
    ],
  });

  expect(parseSmartCartStored(null)).toEqual({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });
  expect(parseSmartCartStored(["not", "cart", "state"])).toEqual({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });
});

test("reads and writes only sanitized smart-cart state through ephemeral storage", async () => {
  mockJsonGet.mockResolvedValue({
    selectedUrlByIngredient: {
      RICE: "https://www.sayweee.com/product/rice",
      tofu: "http://www.sayweee.com/product/tofu",
    },
    confirmedTokens: ["rice-token", 9],
  });

  await expect(readSmartCart("2026-08-10")).resolves.toEqual({
    selectedUrlByIngredient: {
      rice: "https://www.sayweee.com/product/rice",
    },
    confirmedTokens: ["rice-token"],
  });
  expect(mockJsonGet).toHaveBeenCalledWith(
    expect.anything(),
    "smartShoppingCart:2026-08-10:weee",
  );

  await writeSmartCart("2026-08-10", {
    selectedUrlByIngredient: {
      " RICE ": "https://www.sayweee.com/product/rice",
      tofu: "https://example.com/product/tofu",
    },
    confirmedTokens: ["rice-token", ""],
  });
  expect(mockJsonSet).toHaveBeenCalledWith(expect.anything(), "smartShoppingCart:2026-08-10:weee", {
    selectedUrlByIngredient: {
      rice: "https://www.sayweee.com/product/rice",
    },
    confirmedTokens: ["rice-token"],
  });
});

test("clears only the active week's smart-cart key", async () => {
  await clearSmartCart("2026-08-10");

  expect(mockJsonSet).toHaveBeenCalledWith(
    expect.anything(),
    "smartShoppingCart:2026-08-10:weee",
    { selectedUrlByIngredient: {}, confirmedTokens: [] },
  );
  expect(mockEphemeralRemove).toHaveBeenCalledTimes(1);
  expect(mockEphemeralRemove).toHaveBeenCalledWith("smartShoppingCart:2026-08-10:weee");
});

test("a cart tombstone prevents failed removal from resurrecting progress on the next read", async () => {
  const weekStart = "2026-08-24";
  let backing: unknown = {
    selectedUrlByIngredient: { rice: "https://www.sayweee.com/product/rice" },
    confirmedTokens: ["old-token"],
  };
  mockJsonGet.mockImplementation(async () => backing);
  mockJsonSet.mockImplementation(async (_backend, _key, value) => {
    backing = value;
  });
  mockEphemeralRemove.mockRejectedValue(new Error("remove denied"));

  await expect(clearSmartCart(weekStart)).resolves.toBeUndefined();
  await expect(readSmartCart(weekStart)).resolves.toEqual({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });
});

test("same-session suppression hides stale cart data when both tombstone and removal fail", async () => {
  const weekStart = "2026-08-31";
  const stale = {
    selectedUrlByIngredient: { rice: "https://www.sayweee.com/product/rice" },
    confirmedTokens: ["old-token"],
  };
  mockJsonGet.mockResolvedValue(stale);
  mockJsonSet.mockRejectedValue(new Error("write denied"));
  mockEphemeralRemove.mockRejectedValue(new Error("remove denied"));

  await expect(clearSmartCart(weekStart)).rejects.toThrow("write denied");
  await expect(readSmartCart(weekStart)).resolves.toEqual({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });

  mockJsonSet.mockResolvedValue(undefined);
  await writeSmartCart(weekStart, stale);
  await expect(readSmartCart(weekStart)).resolves.toEqual(stale);
});

test("serializes reset storage before a later selection write", async () => {
  const weekStart = "2026-09-07";
  const tombstone = deferred<void>();
  let backing: unknown = {
    selectedUrlByIngredient: { rice: "https://www.sayweee.com/product/old-rice" },
    confirmedTokens: ["old-token"],
  };
  let setCalls = 0;
  mockJsonGet.mockImplementation(async () => backing);
  mockJsonSet.mockImplementation(async (_backend, _key, value) => {
    setCalls += 1;
    if (setCalls === 1) await tombstone.promise;
    backing = value;
  });
  mockEphemeralRemove.mockImplementation(async () => {
    backing = null;
  });
  const later = {
    selectedUrlByIngredient: { rice: "https://www.sayweee.com/product/new-rice" },
    confirmedTokens: [],
  };

  const resetPromise = clearSmartCart(weekStart);
  const laterWrite = writeSmartCart(weekStart, later);
  const immediateRemountRead = readSmartCart(weekStart);
  await waitFor(() => expect(mockJsonSet).toHaveBeenCalledTimes(1));
  expect(mockJsonSet).toHaveBeenLastCalledWith(
    expect.anything(),
    smartCartKey(weekStart),
    { selectedUrlByIngredient: {}, confirmedTokens: [] },
  );

  tombstone.resolve();
  await Promise.all([resetPromise, laterWrite]);
  expect(backing).toEqual(later);
  await expect(immediateRemountRead).resolves.toEqual(later);
  await expect(readSmartCart(weekStart)).resolves.toEqual(later);
});

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
    queries: { fresh: "fresh", exact: "exact", missing: "missing" },
  });
});

test("accepts stored positives only strictly before their authoritative expiry", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const exactMax = "2026-08-16T12:00:00.000Z";
  const beyondMax = "2026-08-16T12:00:00.001Z";

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
  expect(
    isFreshStoredProductResponse({ products: [product], expires_at: exactMax }, now),
  ).toBe(true);
  expect(
    isFreshStoredProductResponse({ products: [product], expires_at: beyondMax }, now),
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

test("does not derive query metadata from invalid legacy entries", () => {
  expect(
    parseSmartProductsStored({
      open: { RICE: "yes" },
      products: { RICE: { products: [], expires_at: null } },
      errors: { RICE: 42 },
    }),
  ).toEqual({ open: {}, products: {}, errors: {}, queries: {} });
});

test("derives the first cleaned query from a valid nonempty legacy key", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");

  expect(
    parseSmartProductsStored(
      {
        open: { RICE: true, " rice ": false },
        products: {
          RICE: { products: [product], expires_at: "2026-08-15T12:00:00.001Z" },
        },
        errors: { RICE: null },
      },
      now,
    ),
  ).toEqual({
    open: { rice: false },
    products: {
      rice: { products: [product], expires_at: "2026-08-15T12:00:00.001Z" },
    },
    errors: { rice: null },
    queries: { rice: "RICE" },
  });
});
