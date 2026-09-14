# Weee Cart Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn existing Weee product matches into an editable, resumable cart draft with a transparent one-item-at-a-time retailer handoff on web and native mobile.

**Architecture:** A pure `@cooking/shared` cart-draft builder owns default selection, explicit alternatives, progress validation, and conservative subtotal parsing. Web and mobile persist only product-choice URLs and user-confirmed progress in their existing week-scoped ephemeral stores, then render platform-native review/handoff UI. All external navigation passes the existing Weee URL guard, and no backend or retailer-authentication behavior changes.

**Tech Stack:** TypeScript, Vitest, React Testing Library, Next.js 14/React 18, React Native/Expo/React 19, Jest/RNTL, Playwright

**Spec:** `docs/superpowers/specs/2026-08-29-weee-cart-companion-design.md`

## Global Constraints

- Do not deploy, call undocumented Weee endpoints, collect retailer credentials/cookies, or automate checkout.
- Never describe a page open as an authoritative Weee cart mutation; only user confirmation may create local `confirmed` progress.
- Preserve current refinement, product lookup/cache/expiry/retry, planner staleness, checked/hidden, and safe-URL behavior.
- Use only product URLs accepted by `isSafeWeeeProductUrl` for selection or navigation.
- Parse only standalone `$/US$` prices; never guess ranges, promotions, multi-buy text, non-dollar currency, fees, tax, or inventory.
- Preserve the user's pre-existing dirty files: `apps/mobile/metro.config.js`, `apps/mobile/package.json`, `package-lock.json`, `apps/mobile/metro.config.test.cjs`, `backend/.venv_fresh/`, `backend/pytest 2.ini`, and `backups/`.
- Work in the current checkout under the user's explicit overnight authorization; do not stage, commit, push, or deploy.

---

### Task 1: Shared cart-draft contract

**Files:**
- Create: `packages/shared/src/cartAssistant.ts`
- Create: `packages/shared/src/cartAssistant.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `isSafeWeeeProductUrl(value: string): boolean` from `packages/shared/src/store.ts`.
- Produces: `CartAssistantProduct`, `CartAssistantIngredient`, `CartAssistantSelection`, `CartAssistantDraft`, `buildCartAssistantDraft(...)`, `parseCartPriceCents(...)`, and `cartConfirmationToken(...)`.

- [ ] **Step 1: Write failing default-selection and alternative-selection tests**

Create literal products and assert that this wished-for API selects the first safe product, honors a still-available explicit URL, and falls back when the explicit URL is unsafe or no longer returned:

```ts
const draft = buildCartAssistantDraft({
  ingredients: [{ key: "rice", name: "Rice", suggestedPurchase: "1 bag", products: [riceA, riceB] }],
  selectedUrlByIngredient: { rice: riceB.url },
  confirmedTokens: new Set(),
});
expect(draft.selections[0].product.url).toBe(riceB.url);
```

- [ ] **Step 2: Run RED**

Run: `npm --workspace @cooking/shared test -- src/cartAssistant.test.ts`

Expected: FAIL because `cartAssistant.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure model**

Use these public shapes:

```ts
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
```

`cartConfirmationToken(key, url)` binds progress to both ingredient identity and selected URL. `buildCartAssistantDraft` filters with `isSafeWeeeProductUrl`, caps candidates at three, and never mutates inputs.

- [ ] **Step 4: Add failing conservative-price and confirmation tests**

Use literal expectations: `$2.99 -> 299`, `US$12 -> 1200`, while `$2.99-$4.99`, `2 for $5`, `$3.99 $5.99`, `€2.99`, blank, and prose return `null`. Assert draft subtotal, unpriced count, and confirmed/remaining counts.

- [ ] **Step 5: Run RED, implement price parsing, and run GREEN**

Run the focused shared test after adding assertions, confirm the price tests fail for missing behavior, implement only the anchored dollar parser and integer-cent sum, then rerun.

Expected: all focused shared tests PASS.

- [ ] **Step 6: Export and type-check the shared contract**

Add `export * from "./cartAssistant";` to `packages/shared/src/index.ts`.

Run: `npx tsc -p packages/shared/tsconfig.json --noEmit`

Expected: exit 0.

---

### Task 2: Web week-scoped cart state and selectable product rows

**Files:**
- Create: `apps/web/app/shopping-list/cartAssistantStorage.ts`
- Create: `apps/web/app/shopping-list/cartAssistantStorage.test.ts`
- Modify: `apps/web/app/shopping-list/ProductPicks.tsx`
- Modify: `apps/web/app/shopping-list/ProductPicks.test.tsx`
- Modify: `apps/web/app/shopping-list/ShoppingItemRow.tsx`
- Modify: `apps/web/app/shopping-list/ShoppingCategorySection.tsx`
- Modify: `apps/web/app/shopping-list/ShoppingList.module.css`

**Interfaces:**
- Consumes: Task 1 model and current `ProductLookupState` success products.
- Produces: `CartAssistantStored`, `parseCartAssistantStored(value)`, `cartAssistantStorageKey(weekStart)`, and product-row props `ingredientKey`, `selectedUrl`, `onSelect(productUrl)`.

- [ ] **Step 1: Write storage parser tests and run RED**

The parser accepts only object maps of canonical ingredient keys to safe product URLs plus an array of string confirmation tokens. It drops empty keys, unsafe URLs, non-string values, and malformed confirmation entries. The storage key is exactly `smartShoppingCart:<weekStart>:weee`.

Run: `npm --workspace @cooking/web test -- app/shopping-list/cartAssistantStorage.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement and run storage GREEN**

Implement a total parser returning `{ selectedUrlByIngredient: Record<string,string>, confirmedTokens: string[] }`, never throwing on unknown input.

Expected: focused storage tests PASS.

- [ ] **Step 3: Write selectable-row component tests and run RED**

Extend `ProductPicks.test.tsx` to assert first safe result is labelled `Top pick`, the selected URL exposes checked radio semantics and `Selected for cart`, another safe row exposes `Choose <product name> for cart` and calls `onSelect(url)`, and unsafe rows expose neither selection nor navigation.

Run: `npm --workspace @cooking/web test -- app/shopping-list/ProductPicks.test.tsx`

Expected: FAIL because selection controls do not exist.

- [ ] **Step 4: Implement selectable rows and thread callbacks**

Update `ProductPicks`, `ShoppingItemRow`, and `ShoppingCategorySection` without moving lookup ownership. Derive the first safe URL as the selected fallback only for rendering; explicit persistence stays in the page. Style selected state with border/background plus text, not color alone.

- [ ] **Step 5: Run web component GREEN and regression tests**

Run: `npm --workspace @cooking/web test -- app/shopping-list/ProductPicks.test.tsx app/shopping-list/page.productLookup.test.tsx`

Expected: all focused tests PASS and existing lookup behavior remains covered.

---

### Task 3: Web cart review and guided handoff

**Files:**
- Create: `apps/web/app/shopping-list/CartAssistantDialog.tsx`
- Create: `apps/web/app/shopping-list/CartAssistantDialog.test.tsx`
- Modify: `apps/web/app/shopping-list/ShoppingSmartBar.tsx`
- Modify: `apps/web/app/shopping-list/page.tsx`
- Modify: `apps/web/app/shopping-list/page.productLookup.test.tsx`
- Modify: `apps/web/app/shopping-list/ShoppingList.module.css`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Consumes: Task 1 `CartAssistantDraft`; Task 2 explicit selection storage; current visible unchecked purchase rows and successful lookup state.
- Produces: `CartAssistantDialog({ open, draft, skippedTokens, onClose, onOpenProduct, onConfirm, onUndoConfirm, onSkip, onFindMatch })` and smart-bar `onReviewCart`/`cartReadyCount` props.

- [ ] **Step 1: Write dialog behavior tests and run RED**

Cover summary literals, estimated subtotal/unpriced disclosure, current item, unmatched list, and trust copy. Assert `Open next on Weee` calls `onOpenProduct(current.product.url)` once and does not call confirm. Assert `I added it`, `Skip`, and `Undo` call their explicit callbacks with the current confirmation token.

Run: `npm --workspace @cooking/web test -- app/shopping-list/CartAssistantDialog.test.tsx`

Expected: FAIL because the dialog does not exist.

- [ ] **Step 2: Implement accessible dialog and run component GREEN**

Render `role="dialog" aria-modal="true"` with a labelled heading, close button, Escape handler, and trigger focus restoration owned by the page. Skip tokens are passed in and remain session-only.

- [ ] **Step 3: Write page-integration RED tests**

Hydrate a smart list, return two safe products for Rice and one for Kale, then assert review appears only after matches succeed; defaults use first products; choosing Rice's second product changes the review/subtotal; `window.open` receives exactly the current safe URL; marking added persists a week confirmation; changing selection clears the old confirmation; checked/hidden ingredients leave the draft; and malformed/throwing storage does not break interaction.

Run: `npm --workspace @cooking/web test -- app/shopping-list/page.productLookup.test.tsx`

Expected: FAIL on missing cart-review behavior.

- [ ] **Step 4: Integrate draft derivation, persistence, and lifecycle**

Derive ingredients only from visible unchecked purchase items. Feed success products or `[]` into `buildCartAssistantDraft`. Hydrate once per week, prune through the derived model, reset on smart refresh/back/week transition, and write session storage best-effort. Use one `window.open(url, "_blank", "noopener,noreferrer")` per press after revalidating `isSafeWeeeProductUrl`.

- [ ] **Step 5: Add localized copy and CSS, then run GREEN**

Add English/Chinese message keys for top pick, choose/selected, review, counts, estimate, unpriced disclosure, trust notice, open/confirm/skip/undo, unmatched, and final Weee review.

Run: `npm --workspace @cooking/web test -- app/shopping-list/CartAssistantDialog.test.tsx app/shopping-list/ProductPicks.test.tsx app/shopping-list/page.productLookup.test.tsx`

Expected: all focused web tests PASS.

---

### Task 4: Mobile cart state and selectable products

**Files:**
- Modify: `apps/mobile/src/features/shopping/storage.ts`
- Modify: `apps/mobile/src/features/shopping/storage.test.ts`
- Create: `apps/mobile/src/features/shopping/useCartAssistant.ts`
- Create: `apps/mobile/src/features/shopping/useCartAssistant.test.tsx`
- Modify: `apps/mobile/src/features/shopping/StoreProductPicks.tsx`
- Modify: `apps/mobile/src/features/shopping/StoreProductPicks.test.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListItem.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListCard.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListCard.test.tsx`

**Interfaces:**
- Consumes: Task 1 model, `ephemeral` storage, canonical product keys, and current mobile product maps.
- Produces: `smartCartKey(weekStart)`, `readSmartCart`, `writeSmartCart`, `clearSmartCart`, and `useCartAssistant(weekStart, ingredients)` returning `{ draft, selectedUrlByIngredient, confirmedTokens, select, confirm, undoConfirm, reset }`.

- [ ] **Step 1: Write mobile storage RED tests**

Mirror Task 2's validation and exact key behavior using existing storage doubles. Run the focused file and observe failure for missing exports.

Run: `npm --workspace @cooking/mobile test -- --runInBand src/features/shopping/storage.test.ts`

Expected: FAIL because smart-cart storage exports do not exist.

- [ ] **Step 2: Implement storage functions and run GREEN**

Use existing `json`/`ephemeral` helpers. Reads sanitize unknown data, writes accept validated state, and clear removes only the active week's cart key.

- [ ] **Step 3: Write hook RED tests**

Render the hook with literal ingredients/products. Assert hydration, default selection, alternative selection, confirmation token binding, selection-change confirmation clearing, write-failure tolerance, and week reset.

Run: `npm --workspace @cooking/mobile test -- --runInBand src/features/shopping/useCartAssistant.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 4: Implement the hook and run GREEN**

Keep storage effects cancellable on week changes and derive the draft through `buildCartAssistantDraft`; do not duplicate price or selection logic.

- [ ] **Step 5: Write selection UI RED tests**

Add `selectedUrl` and `onSelect` props to `StoreProductPicks`. Assert the selected product has `accessibilityState={{ selected: true }}`, top-pick copy appears only on index zero, and choosing an alternative calls the exact URL. Thread ingredient-keyed state through `SmartListItem` and `SmartListCard`.

- [ ] **Step 6: Implement and run focused mobile GREEN**

Run: `npm --workspace @cooking/mobile test -- --runInBand src/features/shopping/StoreProductPicks.test.tsx src/features/shopping/SmartListCard.test.tsx src/features/shopping/storage.test.ts src/features/shopping/useCartAssistant.test.tsx`

Expected: all focused tests PASS.

---

### Task 5: Mobile review modal and handoff

**Files:**
- Create: `apps/mobile/src/features/shopping/CartAssistantModal.tsx`
- Create: `apps/mobile/src/features/shopping/CartAssistantModal.test.tsx`
- Modify: `apps/mobile/src/features/shopping/ShoppingListScreen.tsx`
- Create or modify: `apps/mobile/src/features/shopping/ShoppingListScreen.test.tsx`

**Interfaces:**
- Consumes: Task 4 hook/draft; React Native `Modal` and `Linking.openURL`.
- Produces: `CartAssistantModal` with current-item navigation and explicit confirm/skip/undo callbacks.

- [ ] **Step 1: Write modal RED tests**

Assert visible summary, selected rows, unmatched list, current product, and trust copy. Pressing `Open next on Weee` calls the supplied opener once; confirmation remains separate. Skip advances but does not alter confirmed count. Closing and reopening receives a fresh empty skipped set from the screen.

Run: `npm --workspace @cooking/mobile test -- --runInBand src/features/shopping/CartAssistantModal.test.tsx`

Expected: FAIL because the modal does not exist.

- [ ] **Step 2: Implement modal and run component GREEN**

Use native `Modal`, `ScrollView`, project `Button`/`Pressable`, accessibility labels, and current theme tokens. Never render or log credentials/session concepts.

- [ ] **Step 3: Write screen-integration RED test**

Provide a ready refined screen state and product-cache fixture, open review, and assert `Linking.openURL` gets only a safe current URL. Assert mark/undo callbacks and button availability. Mock only API/storage boundaries; render real shopping components.

- [ ] **Step 4: Integrate and run mobile GREEN**

Derive cart ingredients from visible unchecked rows and product maps, show `Review Weee cart · N` when `readyCount > 0`, and validate URL again immediately before `Linking.openURL`.

Run: `npm --workspace @cooking/mobile test -- --runInBand src/features/shopping/CartAssistantModal.test.tsx src/features/shopping/ShoppingListScreen.test.tsx src/features/shopping/useCartAssistant.test.tsx`

Expected: all focused tests PASS.

---

### Task 6: End-to-end coverage, documentation, and complete verification

**Files:**
- Modify: `apps/web/e2e/shopping.spec.ts`
- Modify: `CLAUDE.md`
- Create: `docs/qa/2026-08-29-weee-cart-companion-checklist.md`

**Interfaces:**
- Consumes: completed web/mobile flows.
- Produces: deterministic browser acceptance and accurate product/QA references.

- [ ] **Step 1: Add browser RED coverage**

Extend deterministic store fixtures with distinct first/second prices. Test load-all, review availability, default top picks, changing one product, estimated subtotal, one-at-a-time popup URL, explicit confirmation progress, and no horizontal overflow on desktop/phone. Intercept popup behavior rather than navigating the test away.

- [ ] **Step 2: Run Playwright RED, implement only missing integration fixes, then run GREEN**

Run: `npm --workspace @cooking/web run test:e2e -- shopping.spec.ts --project=desktop --project=phone`

Expected after fixes: all shopping browser tests PASS.

- [ ] **Step 3: Update authoritative documentation**

Update `CLAUDE.md` product summary, web/mobile shopping descriptions, state/storage behavior, and explicit Weee limitation. Add a morning QA checklist with exact local commands, flows, fixture expectations, and the trust boundary: the user adds items and confirms; Chef World does not claim direct cart writes.

- [ ] **Step 4: Run full verification gates**

Run fresh, in order:

```bash
npm --workspace @cooking/shared test
npm --workspace @cooking/web test
npm --workspace @cooking/mobile test -- --runInBand
npx tsc -p packages/shared/tsconfig.json --noEmit
npx tsc -p apps/web/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.json --noEmit
npm --workspace @cooking/web run lint
npm --workspace @cooking/web run build
npm --workspace @cooking/web run test:e2e -- shopping.spec.ts --project=desktop --project=phone
git diff --check
git status --short
```

Record exact pass/fail counts and distinguish pre-existing warnings or dirty files from new failures.

- [ ] **Step 5: Review against the specification**

Request a final code review using the full uncommitted diff against `HEAD`, the spec path, this plan path, and the starting dirty-file list. Fix Critical/Important issues, re-run their covering tests, then repeat the complete verification gates before any completion claim.
