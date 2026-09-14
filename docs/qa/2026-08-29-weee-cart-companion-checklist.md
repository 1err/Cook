# Weee Cart Companion Morning QA

**Date:** 2026-08-29

**Scope:** local web + native mobile only

**Deployment:** none; this checklist does not publish, push, place an order, or change a real Weee cart

## Fast automated check

From the repository root:

```bash
npm --workspace @cooking/shared test
npm --workspace @cooking/web test
npm --workspace @cooking/mobile test -- --runInBand
npx tsc -p packages/shared/tsconfig.json --noEmit
npx tsc -p apps/web/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.json --noEmit
npm --workspace @cooking/web run build
npm --workspace @cooking/web run test:e2e -- shopping.spec.ts --project=desktop --project=phone
git diff --check
git status --short
```

`npm --workspace @cooking/web run lint` currently opens Next.js's first-run ESLint setup because the repository has no ESLint configuration. Cancel it; do not create a configuration as part of this QA pass.

## Deterministic browser fixture

The Playwright command above runs the shopping flow at desktop and iPhone 13 sizes without using a real account, retailer session, or live Weee inventory.

- Week: `2026-08-10`
- Ingredients: Jasmine rice, Kale, Whole milk
- Review button before safe matches: absent
- Default selected top picks: Jasmine rice bag `$5.00`, Organic kale bunch `$2.99`, Whole milk carton `$4.01`
- Default estimate: `$12.00`
- Kale alternative: Baby kale `$3.49`
- Estimate after choosing Baby kale: `$12.50`
- First guided URL: `https://www.sayweee.com/product/rice-1`
- Opening that URL: one intercepted open call, `0 marked as added`, current item remains Jasmine rice
- Pressing **I added it**: `1 marked as added`, current item advances to Kale, and a reload of the same week retains that progress
- Pressing **Skip for now**: advances in the open review only; skipping every remaining item ends at **Review pass complete**, and close/reopen returns to the first skipped item
- Pressing **Undo Jasmine rice**: removes its confirmation and makes it current again
- Confirming all three: heading becomes **Handoff complete** and the final link is exactly `https://www.sayweee.com/`
- Pending fixture: `1 ready`, `0 unmatched`, `2 finding matches` while Kale and milk are live; after an unsafe Kale result and authoritative empty milk result settle, it becomes `2 unmatched` and never renders the unsafe product
- Dialog checks: native dialog with heading **Review Weee cart**, no page/dialog horizontal overflow on desktop or phone
- Trust copy: **Chef World has not changed your Weee cart**

The desktop raster golden intentionally includes the new Top pick/Selected/Choose radio controls. It runs only on macOS, where the tracked deterministic baseline is `apps/web/e2e/__screenshots__/shopping.spec.ts/shopping-smart-desktop-darwin.png`; desktop and phone semantic/layout acceptance remains portable and runs on every platform. There is no stale Linux raster baseline to silently bless.

## Manual web flow

1. Start the local stack:

   ```bash
   docker compose up --build -d
   ```

2. Open `http://localhost:3000`, sign in to a local account, add at least one recipe to a planner week, and open that week's Shopping tab.
3. Press **Prepare smart shopping list**. Confirm checked (`Already have`) and hidden ingredients are not included in cart review.
4. Press **Load top picks from Weee**. Confirm the review action is unavailable before the first safe match and appears as **Review Weee cart (N)** afterward.
5. In each expanded unchecked product group, confirm exactly one native radio is checked. The first safe row says **Top pick** and **Selected for cart**. A checked/Already-have row may keep its safe Weee links visible, but must not show Top pick, Selected, Choose, or radio controls.
6. Choose a second product. Open review and confirm its product/price and the **Estimated subtotal** update; ambiguous or missing prices must be disclosed as unpriced, not guessed.
7. While another match is queued/loading, confirm it appears under **Finding matches**, not **Needs a match**. An empty/error/unsafe-only settled result belongs under **Needs a match**.
8. Press **Open next on Weee** once. Confirm one product page opens in a new tab, the dialog says **Open again**, the item does not become confirmed, and the original Chef World tab remains available.
9. Return to Chef World and press **I added it**. Confirm the marked count increments and the next unconfirmed item becomes current.
10. Skip every remaining selected item. Confirm the heading is **Review pass complete**, not **Handoff complete**. Close and reopen review; confirmations persist, while skips do not.
11. Press **Undo** on a confirmed item. Confirm it returns to the unconfirmed sequence.
12. Confirm all selected items. Verify **Handoff complete** and **Open Weee for final review** appear. Review price, availability, package quantity, delivery eligibility, fees, and the actual cart on Weee yourself.

## Manual mobile flow

Start the backend, then use the development client/simulator:

```bash
cd apps/mobile
npx expo start --dev-client
```

For a physical phone, set `EXPO_PUBLIC_API_BASE=http://<lan-ip>:8000` before starting Expo. The cart companion itself does not require the iOS Share Sheet extension.

1. Open Shopping for a planned week, prepare the smart list, then press **Load top picks from Weee**.
2. Confirm the first safe product on an unchecked row is selected and VoiceOver/accessibility state reports the selected control. Choose an alternative and verify only one choice remains selected. Check that row as Already have: its Weee links may remain visible, but its cart-choice controls must disappear.
3. Press **Review Weee cart · N**. Confirm ready/pending/unmatched/marked counts, estimate disclosure, selected rows, and the current item.
4. Press **Open next on Weee**. Confirm the OS opens only that URL-validated official-host URL; returning to Chef World must leave the item unconfirmed.
5. Exercise **I added it**, **Skip for now**, **Undo**, close/reopen, and final Weee review. When a selected item remains skipped, verify **Review pass complete**; reserve **Handoff complete** for all explicitly confirmed selections. A rejected link open must leave the item current and show a retryable error.
6. Confirm duplicate/case-equivalent refined ingredients appear once in the cart draft, using the first visible unchecked occurrence.

## Session, week, reset, and failure checks

- Same-week web reload: explicit alternative + confirmation survive through `smartShoppingCart:{weekMonday}:weee`.
- Mobile foreground within the same app session: the same state survives through the `ephemeral` key of that name.
- Week switch: only the destination week's cart/product/list keys hydrate. A late source-week refresh must not overwrite or clear destination-week state.
- Successful smart-list regeneration or **Back to original list**: selections, confirmations, skips, dialog/modal, and live product results clear.
- Failed regeneration/back transition: current cart review remains intact.
- Product revalidation: a valid confirmation survives queued/loading, then is pruned if the authoritative settled result no longer contains the selected URL.
- Mobile cold hydration: cart authority stays unavailable until the current week's product cache read settles. After hydration, queued/loading rows are **Finding matches**; never-requested and expired-unknown rows are **Needs a match**. An expired closed product plus persisted `errors[key] = null` keeps its dormant explicit choice/confirmation until a real product array or string error settles compatibility, without claiming that a match is actively loading.
- Authority expiry: live and stored positive responses expiring more than 24 hours from receipt are rejected; they must not create a selected product or inflate the subtotal.
- Selection change: the old ingredient+URL confirmation is cleared immediately.
- Checked/hidden row: leaves the active draft and cannot be opened from review. Checked rows retain safe retailer links only; they expose no cart-selection controls.
- Reset storage failure: when cart-key removal is denied, an empty tombstone prevents confirmations from returning after remount. When both write and removal are denied, same-session hydration still stays empty. On mobile, make a new selection immediately after reset and remount; the later selection must win the serialized per-week storage queue.
- Malformed/unsafe stored choice: in DevTools, set the week key to an unsafe URL, reload, and confirm it is ignored:

  ```js
  sessionStorage.setItem("smartShoppingCart:2026-08-10:weee", JSON.stringify({
    selectedUrlByIngredient: { rice: "https://sayweee.com.evil.test/product/rice" },
    confirmedTokens: []
  }));
  location.reload();
  ```

- Storage write denial: unit coverage deliberately throws on `sessionStorage.setItem`; live selection/review/link behavior remains usable. Run:

  ```bash
  npm --workspace @cooking/web test -- app/shopping-list/page.productLookup.test.tsx
  npm --workspace @cooking/mobile test -- --runInBand src/features/shopping
  ```

## Current direct-cart boundary

No published Weee consumer API, OAuth flow, bulk-cart endpoint, or documented add-to-cart deep link was found in the 2026-08-29 review. This implementation therefore does not collect Weee credentials, inspect/replay retailer cookies, call private endpoints, write a cart, or check out. It opens URL-validated official-host product pages in the user's own Weee session; only the user's **I added it** action records local progress.

Weee's current [Terms of Service](https://www.weee.com/company/terms), reviewed on 2026-08-29, prohibit automated or unconventional access and scraping. The existing public-search lookup scraper is therefore a separate authorization and policy risk that requires product/legal review and permitted access; an official-host result URL is not a claim of Terms compliance. The cart companion does not expand that lookup into credential, cookie, private-endpoint, cart-write, or checkout automation. This is a product/engineering boundary, not legal advice.

The next product step is to contact Weee through its [partnership program](https://www.weee.com/company/partners), [affiliate program](https://www.weee.com/company/affiliates-en), or [contact channel](https://www.weee.com/en/account/contact-us). Request a documented authorization contract for both product lookup and any future cart integration, stable product IDs, idempotent bulk/add-item semantics, per-item errors, regional inventory behavior, sandbox, rate limits, and written permission for automated cart writes.
