import { expect, test } from "vitest";
import {
  cartAssistantStorageKey,
  parseCartAssistantStored,
} from "./cartAssistantStorage";

test("keeps only safe selections and string confirmation tokens from stored cart data", () => {
  expect(parseCartAssistantStored({
    selectedUrlByIngredient: {
      rice: "https://www.sayweee.com/product/jasmine-rice",
      tofu: "https://example.com/product/tofu",
      "": "https://www.sayweee.com/product/empty-key",
      noodles: 42,
    },
    confirmedTokens: ["[\"rice\",\"https://www.sayweee.com/product/jasmine-rice\"]", "", 7, null],
  })).toEqual({
    selectedUrlByIngredient: {
      rice: "https://www.sayweee.com/product/jasmine-rice",
    },
    confirmedTokens: ["[\"rice\",\"https://www.sayweee.com/product/jasmine-rice\"]"],
  });
});

test("canonicalizes keys and keeps the first safe stored selection for each ingredient", () => {
  expect(parseCartAssistantStored({
    selectedUrlByIngredient: {
      " Jasmine   Rice ": "https://www.sayweee.com/product/first-rice",
      "JASMINE RICE": "https://www.sayweee.com/product/later-jasmine-rice",
      " jasmine rice ": 42,
      RICE: "https://www.sayweee.com/product/plain-rice",
      " rice ": "https://www.sayweee.com/product/later-plain-rice",
      TOFU: "https://example.com/product/tofu",
    },
    confirmedTokens: [],
  })).toEqual({
    selectedUrlByIngredient: {
      "jasmine rice": "https://www.sayweee.com/product/first-rice",
      rice: "https://www.sayweee.com/product/plain-rice",
    },
    confirmedTokens: [],
  });
});

test("returns an empty cart state for unknown stored values", () => {
  expect(parseCartAssistantStored(null)).toEqual({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });
  expect(parseCartAssistantStored(["not", "a", "stored cart"])).toEqual({
    selectedUrlByIngredient: {},
    confirmedTokens: [],
  });
});

test("uses the week-scoped Weee cart storage key", () => {
  expect(cartAssistantStorageKey("2026-08-10")).toBe("smartShoppingCart:2026-08-10:weee");
});
