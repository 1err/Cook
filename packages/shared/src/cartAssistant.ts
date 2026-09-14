import { isSafeWeeeProductUrl } from "./store";

export type CartAssistantProduct = { name: string; price: string; image: string; url: string };

export type CartAssistantIngredient = {
  key: string;
  name: string;
  suggestedPurchase: string;
  products: CartAssistantProduct[];
};

export type CartAssistantSelection = {
  ingredientKey: string;
  ingredientName: string;
  suggestedPurchase: string;
  product: CartAssistantProduct;
  confirmationToken: string;
  confirmed: boolean;
};

export type CartAssistantDraft = {
  selections: CartAssistantSelection[];
  unmatched: Array<Pick<CartAssistantIngredient, "key" | "name" | "suggestedPurchase">>;
  summary: {
    readyCount: number;
    unmatchedCount: number;
    confirmedCount: number;
    remainingCount: number;
    estimatedSubtotalCents: number;
    unpricedCount: number;
  };
};

export function cartConfirmationToken(key: string, url: string): string {
  return JSON.stringify([key, url]);
}

export function parseCartPriceCents(price: string): number | null {
  const match = /^(?:US)?\$(\d+)(?:\.(\d{2}))?$/.exec(price.trim());

  if (!match) return null;

  const cents = Number(match[1]) * 100 + Number(match[2] ?? 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function buildCartAssistantDraft({
  ingredients,
  selectedUrlByIngredient,
  confirmedTokens,
}: {
  ingredients: CartAssistantIngredient[];
  selectedUrlByIngredient: Record<string, string | undefined>;
  confirmedTokens: ReadonlySet<string>;
}): CartAssistantDraft {
  const selections: CartAssistantSelection[] = [];
  const unmatched: CartAssistantDraft["unmatched"] = [];

  for (const ingredient of ingredients) {
    const products = ingredient.products.filter((product) => isSafeWeeeProductUrl(product.url)).slice(0, 3);
    const selectedUrl = selectedUrlByIngredient[ingredient.key];
    const product = products.find((candidate) => candidate.url === selectedUrl) ?? products[0];

    if (!product) {
      unmatched.push({
        key: ingredient.key,
        name: ingredient.name,
        suggestedPurchase: ingredient.suggestedPurchase,
      });
      continue;
    }

    const confirmationToken = cartConfirmationToken(ingredient.key, product.url);
    selections.push({
      ingredientKey: ingredient.key,
      ingredientName: ingredient.name,
      suggestedPurchase: ingredient.suggestedPurchase,
      product,
      confirmationToken,
      confirmed: confirmedTokens.has(confirmationToken),
    });
  }

  const confirmedCount = selections.filter((selection) => selection.confirmed).length;
  const prices = selections.map((selection) => parseCartPriceCents(selection.product.price));

  return {
    selections,
    unmatched,
    summary: {
      readyCount: selections.length,
      unmatchedCount: unmatched.length,
      confirmedCount,
      remainingCount: selections.length - confirmedCount,
      estimatedSubtotalCents: prices.reduce<number>((sum, price) => sum + (price ?? 0), 0),
      unpricedCount: prices.filter((price) => price === null).length,
    },
  };
}
