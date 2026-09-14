import { isSafeWeeeProductUrl } from "@cooking/shared";
import { canonicalIngredientKey } from "./productLookupCoordinator";

export type CartAssistantStored = {
  selectedUrlByIngredient: Record<string, string>;
  confirmedTokens: string[];
};

const EMPTY_CART_ASSISTANT_STORED: CartAssistantStored = {
  selectedUrlByIngredient: {},
  confirmedTokens: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cartAssistantStorageKey(weekStart: string): string {
  return `smartShoppingCart:${weekStart}:weee`;
}

export function parseCartAssistantStored(value: unknown): CartAssistantStored {
  if (!isRecord(value)) return { ...EMPTY_CART_ASSISTANT_STORED };

  const selectedUrlByIngredient: Record<string, string> = {};
  if (isRecord(value.selectedUrlByIngredient)) {
    for (const [ingredientKey, url] of Object.entries(value.selectedUrlByIngredient)) {
      const canonicalKey = canonicalIngredientKey(ingredientKey);
      if (
        canonicalKey
        && !Object.prototype.hasOwnProperty.call(selectedUrlByIngredient, canonicalKey)
        && typeof url === "string"
        && isSafeWeeeProductUrl(url)
      ) {
        selectedUrlByIngredient[canonicalKey] = url;
      }
    }
  }

  const confirmedTokens = Array.isArray(value.confirmedTokens)
    ? value.confirmedTokens.filter((token): token is string => typeof token === "string" && Boolean(token.trim()))
    : [];

  return { selectedUrlByIngredient, confirmedTokens };
}
