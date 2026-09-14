# Weee Cart Companion Design

**Date:** 2026-08-29

**Status:** Approved through the user's explicit overnight implementation delegation

**Platforms:** Web and native mobile

## Summary

Chef World will turn the existing Weee product matches into a reviewable cart draft. After product matches load, the first safe result for every unchecked ingredient is selected automatically. The user can replace that choice with either of the other returned products, review an estimated subtotal and unmatched ingredients, and work through a guided Weee handoff one item at a time.

This release does not claim that Chef World has written to the user's Weee cart. Weee exposes normal user-facing product pages and add-to-cart controls, but no published consumer API, OAuth contract, bulk-cart endpoint, or documented add-to-cart deep link was found. Chef World therefore opens URL-validated official-host product pages in the user's own Weee session and records only user-confirmed progress inside Chef World. It never receives Weee credentials, cookies, payment data, or checkout authority.

Weee's Terms reviewed on 2026-08-29 prohibit automated or unconventional access and scraping. The existing public-search lookup scraper remains a separate authorization and policy risk outside this cart-companion change; an official-host result URL does not make that lookup Terms-compliant. Operating or extending the lookup requires product/legal review and permitted access. The cart companion adds no credential, cookie, private-endpoint, cart-write, or checkout automation. This is an engineering decision record, not legal advice.

The cart draft is intentionally provider-shaped so an official Weee integration can later replace the guided handoff without redesigning the selection experience.

## Product Decision

Three approaches were considered:

1. **Official cart integration.** Best eventual experience, but no published Weee API, OAuth flow, or bulk-cart handoff is currently available. This remains the target after written partner approval.
2. **Private API or unattended browser automation.** Technically conceivable, but brittle across delivery location, authentication, anti-bot challenges, and DOM/API changes. It also creates unacceptable credential, policy, and false-success risks. This is not implemented.
3. **User-controlled cart companion.** Auto-select products, keep the choices editable, summarize the draft, and guide the user through URL-validated official-host product pages in their own session. This is the selected release because it saves the repeated search and decision work while remaining honest and testable.

Official references checked for this decision:

- [Weee consumer terms](https://www.weee.com/company/terms)
- [Weee affiliate program](https://www.weee.com/company/affiliates-en)
- [Weee partnership program](https://www.weee.com/company/partners)
- [Weee contact channels](https://www.weee.com/en/account/contact-us)

## Goals

- Make every successfully matched unchecked ingredient cart-ready without another choice by default.
- Let the user swap the default for another returned Weee product before shopping.
- Show how many ingredients are ready, still loading, unmatched, or already confirmed.
- Show an explicitly estimated subtotal using only parseable displayed product prices.
- Guide the user through one URL-validated official-host Weee product page at a time and preserve progress if the review is closed and reopened during the same saved week.
- Keep web and mobile behavior conceptually identical while following each platform's interaction conventions.
- Preserve current smart-list, checked/hidden, product-cache, expiry, retry, staleness, and safe-URL behavior.
- Keep a pure, shared cart-draft model independent of React, React Native, storage, and retailer authentication.

## Non-goals

- Calling undocumented Weee endpoints or reverse-engineering Weee's private cart protocol.
- Collecting, proxying, persisting, or replaying Weee credentials, cookies, tokens, addresses, or payment data.
- Claiming that opening a product page added an item to the Weee cart.
- Automatically submitting an order or navigating checkout.
- Inferring package quantity from recipe quantity; the user reviews the retailer listing.
- Guaranteeing displayed price, inventory, delivery eligibility, promotions, tax, fees, or final total.
- Adding a backend database model or cross-device cart synchronization in this release.
- Changing the scraper, store cache, LLM refinement, recipe, or planner APIs.
- Deployment.

## Shared Cart-Draft Model

The shared package owns a retailer-neutral pure model in `packages/shared/src/cartAssistant.ts`.

### Inputs

- A visible, unchecked ingredient has a stable ingredient key, display name, suggested purchase amount, and zero to three store products.
- A store product has `name`, `price`, `image`, and `url`.
- A map of explicit selections may choose one product URL per ingredient.
- A set of confirmed ingredient keys represents progress the user explicitly marked as added.

### Derived draft

For each ingredient:

- discard products whose URL fails the provided retailer URL guard;
- use the explicitly selected product when it is still among the safe results;
- otherwise select the first safe result;
- classify a row with no safe result as unmatched;
- retain the ingredient's suggested purchase text as context, not as a retailer quantity command.

The summary returns:

- ready item count;
- unmatched ingredient count;
- confirmed item count;
- remaining item count;
- parsed estimated subtotal and the count of selected prices that could not be parsed.

Only a standalone US-dollar string such as `$2.99` or `US$2.99` contributes to the subtotal. Ranges, multi-buy strings, crossed-out/promotional combinations, and non-dollar prices remain unpriced rather than being guessed.

### Adapter boundary

The draft contains all data a future supported provider adapter needs: ingredient identity, requested amount, chosen product identity/URL, and user progress. This release has a `guided` capability only. A future `direct` capability must be backed by a documented provider contract and return authoritative per-item results; the UI must never infer success from a link open.

## Web Experience

### Product choice

After a product lookup succeeds:

- the first safe product is visually labelled `Top pick` and selected unless the user previously chose another safe result;
- every product row exposes one `Choose for cart` radio-style action;
- the selected row exposes `Selected for cart`;
- changing a selection updates the cart draft immediately;
- checked (`Already have`) and hidden ingredients are excluded from the draft without deleting cached product results.

### Cart companion panel

Once at least one ingredient has a successful match, the smart status bar exposes `Review Weee cart`. The panel is an in-page dialog/sheet with:

- ready, unmatched, and confirmed counts;
- estimated subtotal labelled as an estimate, plus an unpriced-item disclosure when needed;
- one compact row per selected product with ingredient, requested amount, product, and displayed price;
- a separate unmatched list with a direct return-to-products action;
- a clear notice that price and availability are confirmed on Weee and Chef World has not changed the user's retailer cart.

### Guided handoff

The panel focuses the first unconfirmed selected item. `Open next on Weee` opens only that URL-validated official-host product URL in a new tab, avoiding popup-blocked multi-tab behavior. On return, the user chooses:

- `I added it` — records local confirmation and advances;
- `Skip` — advances for this review session without claiming success;
- `Open again` — reopens the same URL-validated official-host URL.

Confirmed progress remains visible and can be undone. When all selected items are confirmed or skipped, the panel offers `Open Weee` for final cart review; it does not claim checkout readiness. A pass ending with any selected item skipped says `Review pass complete`; `Handoff complete` is reserved for a pass in which every selected item was explicitly confirmed. Selection and confirmed progress are stored with the existing week-scoped ephemeral shopping state and pruned when an ingredient/product is no longer eligible.

The dialog closes via its close button and Escape, returns focus to the trigger, and does not allow a stale or unsafe URL to open.

## Native Mobile Experience

Mobile mirrors the same cart draft while using the existing vertical screen:

- product rows become selectable and label the top/default choice;
- a `Review Weee cart` button appears after at least one selection exists;
- a native modal presents summary, selected rows, unmatched items, and current progress;
- `Open next on Weee` uses the platform `Linking` API only after the shared Weee URL guard passes;
- the user explicitly marks `I added it` or `Skip` after returning;
- selections and confirmations use the existing week-scoped ephemeral storage abstraction.

No background browser control, WebView credential interception, or automatic checkout is introduced.

## State and Lifecycle

- Default selection is derived, not eagerly written: first safe product wins when no valid explicit choice exists.
- An explicit alternative is persisted by ingredient key and product URL.
- A confirmed key is retained only while that ingredient still has the same selected product URL. Changing the product clears confirmation for that ingredient.
- Checked or hidden ingredients disappear from the active draft; returning them to `to buy` restores a valid explicit selection but not a stale confirmation.
- Refreshing the smart list or switching back to the original list clears cart-draft selections, confirmation, and skip state for that week along with existing product state.
- Expired/revalidated product data prunes an explicit selection if its URL no longer appears.
- Storage failures never block the live React state or retailer link.
- Skips are review-session navigation state and do not mean `added`; they reset when the panel closes.

## Error and Trust Model

- Unsafe or malformed product URLs never enter the cart draft and never open.
- A product lookup error stays local to its ingredient and contributes to unmatched/pending status rather than blocking other items.
- The UI never says `Added to Weee` based on automation, a network response, or a page open. It says `Marked as added` only after the user presses the confirmation action.
- If a popup/link open fails, the item stays current and the user can copy/open its URL-validated official-host link from the selected row.
- The subtotal is always `Estimated`; incomplete pricing is disclosed.
- Location-dependent price and availability are explicitly delegated to the user's Weee session.

## Accessibility and Localization

- Product selection uses native radio semantics on web and selected accessibility state on mobile.
- Cart review has a named heading, clear close action, meaningful progress text, and non-color selected state.
- Touch targets meet the mobile design system minimum.
- New user-facing strings are added to English and Chinese shared messages for web. Mobile follows the repository's existing shopping-copy convention in this slice; full mobile i18n remains outside scope.
- Progress changes use polite live status on web.

## Testing Strategy

### Shared unit tests

- first safe product is selected by default;
- an available explicit alternative wins;
- a stale/unsafe explicit selection falls back safely;
- checked/hidden inputs are excluded by the caller contract;
- confirmation is tied to ingredient plus selected URL;
- safe dollar prices sum exactly;
- ambiguous or non-dollar prices are reported as unpriced and never guessed.

### Web component and integration tests

- product choices expose top-pick and selected semantics;
- choosing an alternative changes the review row and subtotal;
- review is unavailable before any safe result and becomes available after product load;
- only the current product link opens per user gesture;
- `I added it`, skip, undo, close, and reopen preserve the specified progress semantics;
- checked and hidden ingredients leave the draft;
- malformed persisted cart state is ignored and storage write failures do not break interaction.

### Mobile component and integration tests

- product choice callbacks and selected accessibility state are correct;
- cart review derives the same default/alternative selection as web;
- `Linking.openURL` receives only the current URL-validated official-host URL;
- marking, skipping, reopening, and persisted hydration follow the shared contract.

### Verification gates

- Focused shared, web, and mobile tests with observed RED then GREEN cycles.
- Full web Vitest and mobile Jest suites.
- Web and mobile TypeScript checks.
- Web lint and production build.
- Shopping Playwright flow at desktop and phone sizes, including no horizontal overflow.
- `git diff --check` and a final review against this specification.

## Future Direct-Cart Path

Contact `affiliate@sayweee.com`, `marketplace@sayweee.com`, or Weee's partnership channel with a narrow request for a supported recipe-app integration. Ask for documented authentication, product identifiers, bulk cart creation or add-item semantics, per-item errors, regional availability behavior, sandbox access, rate limits, attribution rules, and explicit permission for automated cart writes.

If Weee provides that contract, add a backend provider adapter that exchanges a short-lived user authorization token, creates a cart draft idempotently, reports authoritative per-item results, and never stores a retailer password or payment details. The existing selection/review UI then changes its final action from guided handoff to direct add, while retaining review and per-item error handling.
