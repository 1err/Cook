# Desktop Planner Bounded Week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved bounded desktop Planner with adaptive one-to-three-dish slot filling and an image-rich desktop recipe picker while preserving the current phone and tablet experience.

**Architecture:** Keep the existing Planner state, optimistic mutation queues, drag/drop handlers, and responsive day stacking. Recompose only the desktop page grid so the toolbar spans a bounded rail/board row, add explicit recipe-count state to slot markup for adaptive CSS geometry, and distinguish rail versus picker recipe rendering so the modal can use a visual grid without changing the rail or mobile bottom sheet.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest/Testing Library, Playwright 1.58, existing Chef World CSS/design tokens.

**Spec:** `docs/superpowers/specs/2026-08-18-desktop-planner-bounded-week-design.md`

## Global Constraints

- Desktop-only presentation changes begin at exactly `min-width: 1024px`; phone and tablet behavior at `max-width: 1023px` remains unchanged.
- Keep the centered Planner shell at exactly `max-width: 70rem`.
- Use a desktop rail width of exactly `clamp(13rem, 17vw, 14rem)`.
- At `1280 × 800`, retain 7 day columns, 21 visible meal slots, no document scrolling, no horizontal overflow, and rail/board bottom edges within 1 CSS pixel.
- One recipe fills the recipe viewport with a two-line title; two and three recipes divide it equally with one-line titles; four or more retain three-row geometry and internal scrolling.
- The full recipe title remains in the accessible button name and a native `title` attribute.
- The desktop picker is exactly `min(50rem, calc(100vw - 3rem))`, uses three result columns, and gives each result a `16 / 9` image or existing placeholder.
- Only picker results expose Add buttons; the background rail exposes drag cards only.
- Do not add dependencies, API changes, database changes, localization-copy changes, or a Planner “New recipe” action.
- Preserve existing optimistic saves, drag/drop, focus handoff, overflow cue, filters, recipe opening, and error states.
- Update only governed desktop Planner Darwin/Linux baselines; phone/tablet and Shell baselines must remain byte-stable.

---

### Task 1: Bound the desktop workspace and make meal slots fill intelligently

**Files:**
- Modify: `apps/web/app/planner/page.tsx`
- Modify: `apps/web/app/planner/components/PlannerMealSlot.tsx`
- Modify: `apps/web/app/planner/components/PlannerMealSlot.test.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/planner.spec.ts`

**Interfaces:**
- Consumes: existing `PlannerToolbar`, `PlannerRecipeRail`, `PlannerWeekBoard`, and `PlannerMealSlot` callbacks without changing their public behavioral contracts.
- Produces: `data-recipe-layout="one|two|three|overflow"` on `.planner-slot-recipes__scroll`; an outer `.planner-editorial__toolbar-shell`; a desktop grid row in which `.planner-editorial__sidebar` and `.planner-editorial__main` share height.

- [ ] **Step 1: Add failing component tests for count state and complete titles**

Extend `PlannerMealSlot.test.tsx` with separate tests that render one, two, three, and four valid recipes and assert:

```tsx
expect(screen.getByRole("region")).toHaveAttribute("data-recipe-layout", "one");
expect(screen.getByRole("button", { name: /Open Recipe 1/ })).toHaveAttribute("title", "Recipe 1");
```

Use `two`, `three`, and `overflow` for the other counts. Keep the existing focus, overflow-description, and removal tests unchanged.

- [ ] **Step 2: Run the focused component test and verify RED**

Run:

```bash
npm --workspace @cooking/web test -- app/planner/components/PlannerMealSlot.test.tsx
```

Expected: the new assertions fail because neither `data-recipe-layout` nor `title` exists.

- [ ] **Step 3: Add failing desktop browser geometry assertions**

Extend the desktop Planner Playwright test to measure the rail, week grid, and populated slots:

```ts
const alignment = await page.evaluate(() => {
  const rail = document.querySelector(".planner-editorial__sidebar")!.getBoundingClientRect();
  const board = document.querySelector(".planner-editorial__grid")!.getBoundingClientRect();
  return { bottomDelta: Math.abs(rail.bottom - board.bottom) };
});
expect(alignment.bottomDelta).toBeLessThanOrEqual(1);
```

Add fixtures so the governed Monday slots contain one, two, and three recipes while a fourth slot state still covers overflow. For each non-overflow count, assert the visible recipe rows plus their gaps consume the scroll region’s client height within 1 CSS pixel. For overflow, assert the first three rows fill the client height and the fourth begins below it.

- [ ] **Step 4: Run the focused desktop browser test and verify RED**

Run the desktop project against the existing local fixture using the repository’s Playwright CLI and `planner.spec.ts` grep for the viewport contract.

Expected: rail/board alignment and adaptive-fill assertions fail against the full-height rail and fixed 2.25rem recipe rows.

- [ ] **Step 5: Implement the minimal count contract**

In `PlannerMealSlot.tsx`, derive:

```ts
const recipeLayout = slotRecipes.length > 3
  ? "overflow"
  : (["one", "two", "three"][slotRecipes.length - 1] ?? "one");
```

Set `data-recipe-layout={recipeLayout}` on the scroll region and `title={recipe.title}` on `RecipeTile`’s button. Do not change the existing aria-label.

- [ ] **Step 6: Recompose the Planner grid without changing phone order**

In `page.tsx`, wrap the existing `PlannerToolbar` in `.planner-editorial__toolbar-shell`, make it the first visible Planner child, then render `PlannerRecipeRail` and `.planner-editorial__main` as the second desktop grid row. Keep the guide, error states, week board, and picker inside `main` in their current order.

In `globals.css`, reproduce the prior mobile toolbar/main gutters outside the desktop media query. Inside `@media (min-width: 1024px)`:

```css
.planner-editorial {
  grid-template-columns: clamp(13rem, 17vw, 14rem) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}

.planner-editorial__toolbar-shell { grid-column: 1 / -1; }
.planner-editorial__sidebar { grid-column: 1; grid-row: 2; }
.planner-editorial__main { grid-column: 2; grid-row: 2; }
```

Give the rail a complete border, rounded outer corners, and hidden outer overflow. Keep `.planner-editorial__sidebar-scroll` as the only rail scroller.

- [ ] **Step 7: Implement adaptive desktop slot geometry**

Within the existing desktop media query, make `.planner-slot-recipes` and its scroll region consume available slot height. Use selectors for the exact data values:

```css
.planner-slot-recipes__scroll[data-recipe-layout="one"] .planner-slot-recipe { flex: 1 1 100%; }
.planner-slot-recipes__scroll[data-recipe-layout="two"] .planner-slot-recipe { flex: 1 1 calc((100% - 0.2rem) / 2); }
.planner-slot-recipes__scroll[data-recipe-layout="three"] .planner-slot-recipe,
.planner-slot-recipes__scroll[data-recipe-layout="overflow"] .planner-slot-recipe { flex: 0 0 calc((100% - 0.4rem) / 3); }
```

Allow the one-recipe title to clamp to two lines. Force two, three, and overflow titles to one line with `text-overflow: ellipsis`; never reduce the title below the current desktop `0.625rem`.

- [ ] **Step 8: Run focused GREEN tests**

Run:

```bash
npm --workspace @cooking/web test -- app/planner/components/PlannerMealSlot.test.tsx app/planner/components/PlannerWeekBoard.test.tsx app/planner/page.test.tsx
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: all focused Planner tests and TypeScript pass.

- [ ] **Step 9: Run the desktop and responsive Planner browser matrix**

Run all projects for `apps/web/e2e/planner.spec.ts` without updating screenshots.

Expected: the new desktop layout assertions pass; phone/tablet stacking, scrolling, guide, picker interaction, and no-horizontal-overflow assertions remain green. Screenshot comparison may fail only because the governed desktop Planner baselines have not yet been updated.

- [ ] **Step 10: Commit Task 1**

```bash
git add apps/web/app/planner/page.tsx apps/web/app/planner/components/PlannerMealSlot.tsx apps/web/app/planner/components/PlannerMealSlot.test.tsx apps/web/app/globals.css apps/web/e2e/planner.spec.ts
git commit -m "feat(planner): bound the desktop week workspace"
```

---

### Task 2: Make the desktop Add flow image-rich and complete visual verification

**Files:**
- Modify: `apps/web/app/planner/page.tsx`
- Modify: `apps/web/app/planner/page.test.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/planner.spec.ts`
- Modify: `apps/web/e2e/__screenshots__/planner.spec.ts/planner-desktop-darwin.png`
- Modify: `apps/web/e2e/__screenshots__/planner.spec.ts/planner-desktop-linux.png`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1’s bounded desktop grid and unchanged `slotPicker`, `handlePickerSelect`, search, filter, and optimistic mutation interfaces.
- Produces: a rail-mode recipe collection with drag behavior and no Add actions; a picker-mode recipe collection with Add actions and the desktop three-column image-card presentation.

- [ ] **Step 1: Add failing page tests for rail/picker separation**

In `page.test.tsx`, open an empty meal slot and assert:

```tsx
const dialog = await screen.findByRole("dialog", { name: /Choose recipe/ });
expect(within(dialog).getAllByRole("button", { name: "Add" })).toHaveLength(2);
expect(within(screen.getByRole("complementary")).queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
expect(within(dialog).getAllByRole("img", { hidden: true }).length).toBeGreaterThan(0);
```

Provide at least one recipe with a `thumbnail_url`; continue covering the placeholder path with another recipe.

- [ ] **Step 2: Run the focused page test and verify RED**

Run:

```bash
npm --workspace @cooking/web test -- app/planner/page.test.tsx
```

Expected: the rail contains duplicate Add actions while the picker is open, so the separation assertion fails.

- [ ] **Step 3: Add failing desktop picker geometry assertions**

In the desktop Playwright test, open an empty slot and assert that `.planner-mobile-picker__list` has three computed grid columns, the sheet width is at most `50rem` and at most `window.innerWidth - 3rem`, every result media box has a `16 / 9` ratio within one CSS pixel, card titles do not exceed two rendered lines, and each result exposes exactly one Add action. In the existing phone/tablet test, assert the same list remains a vertical flex list and the sheet remains bottom-aligned.

- [ ] **Step 4: Run desktop and phone picker tests and verify RED**

Run the focused Playwright tests for the desktop viewport contract and responsive picker contract.

Expected: the desktop picker fails because it is still a narrow vertical list; phone/tablet assertions pass before production changes.

- [ ] **Step 5: Separate rail and picker rendering modes**

Replace the single reused `recipeSourceList` value in `page.tsx` with a local renderer accepting `mode: "rail" | "picker"`. Preserve the same filtering, sort order, thumbnails, titles, metadata, and empty states. Apply drag handlers only in rail mode. Render the Add button only in picker mode and keep `handlePickerSelect` unchanged.

- [ ] **Step 6: Implement desktop-only picker cards**

Inside `@media (min-width: 1024px)` only:

```css
.planner-mobile-picker__sheet { width: min(50rem, calc(100vw - 3rem)); }
.planner-mobile-picker__list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.planner-mobile-picker__list .planner-drag-card__thumb { width: 100%; aspect-ratio: 16 / 9; height: auto; }
```

Complete the scoped styles so each picker result is a vertical image card with a two-line title, metadata, and visible Add action. Do not alter the unscoped or `max-width: 1023px` picker styles.

- [ ] **Step 7: Run focused GREEN tests and prove mobile preservation**

Run:

```bash
npm --workspace @cooking/web test -- app/planner
npx tsc -p apps/web/tsconfig.json --noEmit
```

Then run the complete Planner Playwright matrix without snapshot updates. Expected: all behavior and geometry tests pass, with only the two desktop Planner screenshot comparisons requiring intentional regeneration.

- [ ] **Step 8: Regenerate and inspect the Darwin baseline**

Regenerate only the desktop Planner Darwin snapshot with Playwright 1.58. Inspect the `1280 × 800` PNG at original resolution and confirm the bounded rail/board bottom edge, all 7 days and 21 slots, clean long-title truncation, three-row slot filling, overflow cue, and unclipped toolbar.

- [ ] **Step 9: Regenerate and inspect the official Linux baseline**

Use exactly `mcr.microsoft.com/playwright:v1.58.0-noble` under `--platform linux/amd64` to regenerate only `planner-desktop-linux.png`. Inspect it at original resolution, then run a no-update comparison in the same pinned container.

- [ ] **Step 10: Run the complete release gate**

Run:

```bash
npm run test:web
npx tsc -p apps/web/tsconfig.json --noEmit
npm run web:build
```

Run the normal host Planner/Shell/Shopping Playwright comparison, the official Linux Planner comparison, and `git diff --check`. Confirm phone/tablet and every Shell screenshot remain unchanged. Update `CLAUDE.md` with one concise sentence describing the bounded desktop Planner and image-rich desktop picker.

- [ ] **Step 11: Commit Task 2**

```bash
git add apps/web/app/planner/page.tsx apps/web/app/planner/page.test.tsx apps/web/app/globals.css apps/web/e2e/planner.spec.ts apps/web/e2e/__screenshots__/planner.spec.ts/planner-desktop-darwin.png apps/web/e2e/__screenshots__/planner.spec.ts/planner-desktop-linux.png CLAUDE.md
git commit -m "feat(planner): add visual desktop recipe picker"
```

- [ ] **Step 12: Hand off for branch review and deployment**

Generate the whole-branch review package from the branch base through Task 2, complete the required final review/fix loop, then run a fresh full release gate. After integration to `main`, push GitHub, deploy the linked Vercel production project, and verify the production Planner at desktop and phone widths.
