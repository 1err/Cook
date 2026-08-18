# Planner and Shopping Density Implementation Plan

**Goal:** Bring the web Planner and Shopping surfaces back to the restrained Library page rhythm, while making each Planner meal slot show three dishes clearly and scroll internally when it contains more.

## Global Constraints

- Desktop Planner and Shopping content must use a centered, restrained maximum width and typography scale comparable to Library, while phone/tablet layouts remain responsive and readable.
- Planner must show three recipe dishes in every populated meal slot before overflow is needed.
- More than three dishes must remain directly available by scrolling inside that meal slot; do not use the existing “+N more” dialog or hide recipes from the slot.
- Recipe open, remove, add-another, drag/drop, loading-disabled, keyboard, and accessible-name behavior must remain functional.
- Remove only the Planner sidebar “New recipe” footer button. Import links in empty-state guidance remain.
- Keep the Planner desktop week board visible in one viewport at the accepted 1280×800 gate; page/document scrolling must not replace the requested in-slot scrolling.
- Shopping data loading, cache behavior, category layout/order, and mobile behavior are unchanged.
- Use imported Inter for UI font variables so host and Linux screenshot rendering is deterministic.
- Follow TDD: demonstrate focused RED before implementation and GREEN afterward. Update tests and Playwright snapshots only for intentional visual/behavior changes.
- Update `CLAUDE.md` because it is the repository’s authoritative behavior reference.

## Task 1: Planner restrained shell and three-dish scroll slots

**Files:**

- Modify `apps/web/app/planner/page.tsx`
- Modify `apps/web/app/planner/plannerModel.ts`
- Modify `apps/web/app/planner/plannerModel.test.ts`
- Modify `apps/web/app/planner/components/PlannerMealSlot.tsx`
- Modify `apps/web/app/planner/components/PlannerMealSlot.test.tsx`
- Modify `apps/web/app/planner/components/PlannerRecipeRail.tsx` if the footer contract should become optional
- Modify `apps/web/app/planner/components/PlannerRecipeRail.test.tsx` or page tests as appropriate
- Modify Planner-specific rules in `apps/web/app/globals.css`
- Modify `apps/web/e2e/planner.spec.ts`
- Update Planner Darwin/Linux screenshots only when focused comparison proves the intended UI requires it

**Requirements:**

1. Start with failing tests that require three directly rendered recipe tiles, no overflow trigger/dialog, a scrollable recipe-list region for a fourth dish, absence of the Planner New recipe link, and a centered desktop shell that still satisfies the 1280×800 viewport contract.
2. Replace the two-visible-plus-dialog model with a single in-slot list. Three compact dish rows must be fully legible; the list becomes vertically scrollable when a fourth or later dish exists. Keep an accessible add-another control reachable inside or adjacent to the scroll region without hiding dish rows.
3. Remove obsolete overflow-dialog state, focus management, and messages only where no longer used elsewhere. Do not regress recipe opening/removal or focus-visible behavior.
4. Center and cap the desktop Planner shell rather than consuming the full viewport width. Keep all seven days and 21 slots visible at 1280×800, and use a type scale aligned with Library rather than the current oversized Planner heading.
5. Remove the Planner sidebar footer New recipe button and avoid leaving an empty footer region/border.
6. Update focused unit tests and the Planner Playwright contract. The desktop E2E must verify three visible dishes, internal overflow for a fourth dish, no New recipe link, no document vertical overflow, and the existing week/slot accessibility semantics. Responsive projects must remain green.
7. Run focused tests, web typecheck, and focused planner E2E. Generate/inspect platform snapshots as required by the existing Playwright setup.
8. Update `CLAUDE.md` Planner description for three-visible/in-slot scroll and the removed sidebar footer.

## Task 2: Shopping restrained width and Library-like type scale

**Files:**

- Modify Shopping-specific rules in `apps/web/app/globals.css`
- Modify `apps/web/app/shopping-list/page.tsx` only if a semantic wrapper/class is needed
- Add or modify a focused Shopping page/layout test
- Add or modify a Playwright Shopping visual/layout test and platform snapshots only if needed
- Update `CLAUDE.md`

**Requirements:**

1. Start with a failing contract proving the Shopping page uses a centered maximum width comparable to `.app-container` and its primary titles no longer exceed the Library page scale.
2. Reduce `.shop-page--wide` from its current near-full-screen width to a restrained centered shell. Preserve responsive gutters and ensure grocery columns/cards remain usable at desktop, tablet, and phone widths.
3. Align confirmation and smart-mode title sizes/spacing with `.library-page-title`; reduce any immediately subordinate display type that remains disproportionately large. Do not change content, grocery category ordering, Weee loading behavior, cache behavior, or actions.
4. Ensure the explicit imported Inter UI variables apply deterministically across Library, Planner, and Shopping without changing the Source Serif headline family.
5. Run focused tests, full web tests/typecheck/build, and focused browser verification. Update/inspect visual snapshots only for intentional changes.
6. Update `CLAUDE.md` Shopping description with the restrained shell/type rhythm.

## Final Integration and Deployment

1. Run design-token drift, full web unit tests, web TypeScript, production web build, and relevant Planner/Shopping/Shell Playwright projects on Darwin and pinned Linux where screenshots are governed.
2. Dispatch a whole-branch final reviewer and resolve all blocking findings.
3. Fast-forward or merge the reviewed branch into `main`, push `main`, monitor GitHub Actions and Vercel, then verify authenticated production Planner and Shopping at `https://chef-world.com`.
4. Backend is unchanged; do not redeploy AWS for this web-only release.
