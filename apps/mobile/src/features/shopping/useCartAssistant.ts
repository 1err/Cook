import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildCartAssistantDraft,
  isSafeWeeeProductUrl,
  type CartAssistantDraft,
  type CartAssistantIngredient,
} from "@cooking/shared";
import { canonicalStoreProductKey } from "./storeProductIdentity";
import {
  clearSmartCart,
  readSmartCart,
  writeSmartCart,
} from "./storage";

type CartAssistantState = {
  weekStart: string;
  selectedUrlByIngredient: Record<string, string>;
  confirmedTokens: Set<string>;
  hydrated: boolean;
  touched: boolean;
  revision: number;
};

export type MobileCartAssistantIngredient = CartAssistantIngredient & {
  /** True once this ingredient's product lookup reached success, empty, or error. */
  productsSettled: boolean;
  /** True only while this ingredient is queued or actively loading. */
  productsPending: boolean;
};

export type MobileCartAssistantPending = Pick<
  CartAssistantIngredient,
  "key" | "name" | "suggestedPurchase"
>;

export type MobileCartAssistantDraft = CartAssistantDraft & {
  pending: MobileCartAssistantPending[];
  summary: CartAssistantDraft["summary"] & { pendingCount: number };
};

type UseCartAssistantResult = {
  draft: MobileCartAssistantDraft;
  selectedUrlByIngredient: Record<string, string>;
  confirmedTokens: Set<string>;
  select: (ingredientKey: string, productUrl: string) => void;
  confirm: (confirmationToken: string) => void;
  undoConfirm: (confirmationToken: string) => void;
  reset: () => void;
};

function emptyState(weekStart: string): CartAssistantState {
  return {
    weekStart,
    selectedUrlByIngredient: {},
    confirmedTokens: new Set(),
    hydrated: false,
    touched: false,
    revision: 0,
  };
}

function confirmationKey(token: string): string | null {
  try {
    const parsed: unknown = JSON.parse(token);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return canonicalStoreProductKey(parsed[0]);
    }
  } catch {
    // Invalid stored progress is pruned once eligible products are known.
  }
  return null;
}

function safeProductsFor(ingredient: CartAssistantIngredient) {
  return ingredient.products
    .filter((product) => isSafeWeeeProductUrl(product.url))
    .slice(0, 3);
}

function buildMobileCartAssistantDraft({
  ingredients,
  selectedUrlByIngredient,
  confirmedTokens,
}: {
  ingredients: MobileCartAssistantIngredient[];
  selectedUrlByIngredient: Record<string, string>;
  confirmedTokens: ReadonlySet<string>;
}): MobileCartAssistantDraft {
  const pending = ingredients
    .filter((ingredient) => ingredient.productsPending && safeProductsFor(ingredient).length === 0)
    .map(({ key, name, suggestedPurchase }) => ({ key, name, suggestedPurchase }));
  const reviewableIngredients = ingredients.filter(
    (ingredient) => !ingredient.productsPending || safeProductsFor(ingredient).length > 0,
  );
  const draft = buildCartAssistantDraft({
    ingredients: reviewableIngredients,
    selectedUrlByIngredient,
    confirmedTokens,
  });
  return {
    ...draft,
    pending,
    summary: { ...draft.summary, pendingCount: pending.length },
  };
}

/**
 * Pass `null` while the active ingredient list itself is still loading. Once
 * eligibility is known, pass an array (including `[]` when no rows are active).
 */
export function useCartAssistant(
  weekStart: string,
  ingredients: MobileCartAssistantIngredient[] | null,
): UseCartAssistantResult {
  const [state, setState] = useState<CartAssistantState>(() => emptyState(weekStart));
  const hydrationGenerationRef = useRef(0);

  useEffect(() => {
    const generation = hydrationGenerationRef.current + 1;
    hydrationGenerationRef.current = generation;
    setState((current) => (
      current.weekStart === weekStart ? current : emptyState(weekStart)
    ));

    void readSmartCart(weekStart)
      .then((stored) => {
        if (hydrationGenerationRef.current !== generation) return;
        setState((current) => {
          if (current.weekStart !== weekStart) return current;
          if (current.touched) {
            const selectedEntries = Object.entries(current.selectedUrlByIngredient);
            const storedEntries = Object.entries(stored.selectedUrlByIngredient);
            const storedTokens = new Set(stored.confirmedTokens);
            const conflicts = selectedEntries.length !== storedEntries.length
              || selectedEntries.some(([key, url]) => stored.selectedUrlByIngredient[key] !== url)
              || current.confirmedTokens.size !== storedTokens.size
              || [...current.confirmedTokens].some((token) => !storedTokens.has(token));
            return {
              ...current,
              hydrated: true,
              revision: conflicts && current.revision === 0
                ? 1
                : current.revision,
            };
          }
          return {
            weekStart,
            selectedUrlByIngredient: stored.selectedUrlByIngredient,
            confirmedTokens: new Set(stored.confirmedTokens),
            hydrated: true,
            touched: false,
            revision: 0,
          };
        });
      })
      .catch(() => {
        if (hydrationGenerationRef.current !== generation) return;
        setState((current) => (
          current.weekStart === weekStart
            ? {
                ...current,
                hydrated: true,
                revision: current.touched && current.revision === 0
                  ? 1
                  : current.revision,
              }
            : current
        ));
      });

    return () => {
      if (hydrationGenerationRef.current === generation) {
        hydrationGenerationRef.current += 1;
      }
    };
  }, [weekStart]);

  useEffect(() => {
    if (state.weekStart !== weekStart || !state.hydrated || ingredients === null) return;

    const ingredientByKey = new Map(
      ingredients.map((ingredient) => [canonicalStoreProductKey(ingredient.key), ingredient]),
    );

    setState((current) => {
      if (current.weekStart !== weekStart || !current.hydrated) return current;

      const selectedUrlByIngredient: Record<string, string> = {};
      let changed = false;
      for (const [rawKey, url] of Object.entries(current.selectedUrlByIngredient)) {
        const key = canonicalStoreProductKey(rawKey);
        const ingredient = ingredientByKey.get(key);
        const safeProducts = ingredient ? safeProductsFor(ingredient) : [];

        // An absent ingredient is checked/hidden, so retain its explicit choice.
        // A present pending ingredient is still hydrating and is not authoritative.
        if (
          !ingredient ||
          !ingredient.productsSettled ||
          safeProducts.some((product) => product.url === url)
        ) {
          selectedUrlByIngredient[key] = url;
        } else {
          changed = true;
        }
      }

      const draft = buildCartAssistantDraft({
        ingredients,
        selectedUrlByIngredient,
        confirmedTokens: new Set(),
      });
      const validTokenByKey = new Map(
        draft.selections.map((selection) => [
          canonicalStoreProductKey(selection.ingredientKey),
          selection.confirmationToken,
        ]),
      );
      const confirmedTokens = new Set<string>();
      for (const token of current.confirmedTokens) {
        const key = confirmationKey(token);
        if (!key) {
          changed = true;
          continue;
        }
        const ingredient = ingredientByKey.get(key);
        const safeProducts = ingredient ? safeProductsFor(ingredient) : [];
        if (!ingredient) {
          // Eligibility is authoritative and the ingredient left the active list.
          changed = true;
        } else if (!ingredient.productsSettled) {
          confirmedTokens.add(token);
        } else if (validTokenByKey.get(key) === token) {
          confirmedTokens.add(token);
        } else {
          changed = true;
        }
      }

      if (!changed) return current;
      return {
        ...current,
        selectedUrlByIngredient,
        confirmedTokens,
        touched: true,
        revision: current.revision + 1,
      };
    });
  }, [ingredients, state.hydrated, state.weekStart, weekStart]);

  useEffect(() => {
    if (
      state.weekStart !== weekStart ||
      !state.hydrated ||
      state.revision === 0
    ) {
      return;
    }
    void writeSmartCart(weekStart, {
      selectedUrlByIngredient: state.selectedUrlByIngredient,
      confirmedTokens: [...state.confirmedTokens],
    }).catch(() => {
      // Ephemeral persistence is best-effort; the live review remains usable.
    });
  }, [
    state.confirmedTokens,
    state.hydrated,
    state.revision,
    state.selectedUrlByIngredient,
    state.weekStart,
    weekStart,
  ]);

  const activeIngredients = ingredients ?? [];
  const activeState = state.weekStart === weekStart ? state : emptyState(weekStart);
  const draft = useMemo(
    () => buildMobileCartAssistantDraft({
      ingredients: activeIngredients,
      selectedUrlByIngredient: activeState.selectedUrlByIngredient,
      confirmedTokens: activeState.confirmedTokens,
    }),
    [activeIngredients, activeState.confirmedTokens, activeState.selectedUrlByIngredient],
  );

  const select = useCallback((ingredientKey: string, productUrl: string) => {
    const key = canonicalStoreProductKey(ingredientKey);
    const ingredient = activeIngredients.find(
      (candidate) => canonicalStoreProductKey(candidate.key) === key,
    );
    const safeProducts = ingredient ? safeProductsFor(ingredient) : [];
    if (!key || !safeProducts.some((product) => product.url === productUrl)) return;

    setState((current) => {
      if (current.weekStart !== weekStart) return current;
      const explicitUrl = current.selectedUrlByIngredient[key];
      const effectiveUrl = safeProducts.some((product) => product.url === explicitUrl)
        ? explicitUrl
        : safeProducts[0]?.url;
      if (effectiveUrl === productUrl) {
        if (current.hydrated || current.touched) return current;
        return { ...current, touched: true };
      }

      const confirmedTokens = new Set(
        [...current.confirmedTokens].filter((token) => confirmationKey(token) !== key),
      );
      return {
        ...current,
        selectedUrlByIngredient: {
          ...current.selectedUrlByIngredient,
          [key]: productUrl,
        },
        confirmedTokens,
        touched: true,
        revision: current.revision + 1,
      };
    });
  }, [activeIngredients, weekStart]);

  const confirm = useCallback((confirmationToken: string) => {
    setState((current) => {
      if (current.weekStart !== weekStart || current.confirmedTokens.has(confirmationToken)) {
        return current;
      }
      const currentDraft = buildMobileCartAssistantDraft({
        ingredients: activeIngredients,
        selectedUrlByIngredient: current.selectedUrlByIngredient,
        confirmedTokens: current.confirmedTokens,
      });
      if (!currentDraft.selections.some(
        (selection) => selection.confirmationToken === confirmationToken,
      )) {
        return current;
      }
      const confirmedTokens = new Set(current.confirmedTokens);
      confirmedTokens.add(confirmationToken);
      return {
        ...current,
        confirmedTokens,
        touched: true,
        revision: current.revision + 1,
      };
    });
  }, [activeIngredients, weekStart]);

  const undoConfirm = useCallback((confirmationToken: string) => {
    setState((current) => {
      if (current.weekStart !== weekStart || !current.confirmedTokens.has(confirmationToken)) {
        return current;
      }
      const confirmedTokens = new Set(current.confirmedTokens);
      confirmedTokens.delete(confirmationToken);
      return {
        ...current,
        confirmedTokens,
        touched: true,
        revision: current.revision + 1,
      };
    });
  }, [weekStart]);

  const reset = useCallback(() => {
    hydrationGenerationRef.current += 1;
    setState({ ...emptyState(weekStart), hydrated: true });
    void clearSmartCart(weekStart).catch(() => {
      // A failed clear must not restore stale live progress.
    });
  }, [weekStart]);

  return {
    draft,
    selectedUrlByIngredient: activeState.selectedUrlByIngredient,
    confirmedTokens: activeState.confirmedTokens,
    select,
    confirm,
    undoConfirm,
    reset,
  };
}
