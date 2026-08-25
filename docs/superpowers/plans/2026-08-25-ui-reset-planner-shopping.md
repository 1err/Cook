# UI Reset: Planner and Shopping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved desktop weekly matrix and align Shopping with the existing smart-list/product behavior.

**Architecture:** Planner keeps its existing model and mutations but changes composition to a left recipe rail plus day-row matrix. Shopping preserves original/refined state management while extracting visual rows into focused components and rendering product choices vertically.

**Tech Stack:** Next.js, React, TypeScript, CSS Modules/global transitional planner styles, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-chef-world-cross-platform-ui-reset-design.md`

## Global Constraints

- Desktop Planner columns are Day, Breakfast, Lunch, Dinner; days are rows.
- Recipe library stays left and board stays right.
- Rail and board share one exact workspace height with no blank bottom band.
- Remove the Planner Shopping shortcut.
- One/two/three/four-plus recipe compositions follow the spec exactly.
- Shopping keeps original and smart modes, checked/hidden state, staleness, cache, safe-link, and retry behavior.
- Store products render vertically and category headers have no decorative icons.
- No API or model changes.

---

### Task 1: Planner day-row matrix components

**Files:**
- Modify: `apps/web/app/planner/components/PlannerWeekBoard.tsx`
- Modify: `apps/web/app/planner/components/PlannerWeekBoard.test.tsx`
- Modify: `apps/web/app/planner/components/PlannerMealSlot.tsx`
- Modify: `apps/web/app/planner/components/PlannerMealSlot.test.tsx`
- Modify: `apps/web/app/planner/components/PlannerToolbar.tsx`

**Interfaces:**
- `PlannerWeekBoard` keeps its existing props and mutation callbacks.
- `PlannerMealSlot` keeps its existing accessible actions and receives no new backend data.
- Produces `data-recipe-layout="one|two|three|overflow"` for CSS and tests.

- [ ] **Step 1: Rewrite failing board semantics test**

```tsx
expect(screen.getAllByTestId("planner-day-row")).toHaveLength(7);
expect(screen.getAllByTestId("planner-meal-slot")).toHaveLength(21);
expect(screen.getByRole("columnheader", { name: "Breakfast" })).toBeVisible();
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm --workspace @cooking/web test -- PlannerWeekBoard.test.tsx PlannerMealSlot.test.tsx`

Expected: FAIL because the current board is day-column based.

- [ ] **Step 3: Implement row-based board markup**

Render a grid header and seven day rows. Keep `date`, `slot`, drag handlers, choose/open/remove callbacks, accessible region labels, and focus handoff unchanged.

- [ ] **Step 4: Implement adaptive meal content**

One recipe uses the large composition, two and three use equal compact rows, and overflow shows two rows plus an accessible `+ N more` button that opens the complete meal/picker view. Full titles remain in accessible names and `title` attributes.

- [ ] **Step 5: Remove duplicate toolbar navigation**

Delete `shoppingHref` from `PlannerToolbarProps`, its Link import, and the `Shopping list` toolbar link. Keep previous/today/next actions.

- [ ] **Step 6: Run component tests**

Run: `npm --workspace @cooking/web test -- PlannerWeekBoard.test.tsx PlannerMealSlot.test.tsx page.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/planner/components/PlannerWeekBoard.tsx apps/web/app/planner/components/PlannerWeekBoard.test.tsx apps/web/app/planner/components/PlannerMealSlot.tsx apps/web/app/planner/components/PlannerMealSlot.test.tsx apps/web/app/planner/components/PlannerToolbar.tsx apps/web/app/planner/page.test.tsx
git commit -m "feat(planner): switch desktop week to meal matrix"
```

### Task 2: Planner shell, density, and responsive behavior

**Files:**
- Modify: `apps/web/app/planner/page.tsx`
- Modify: `apps/web/app/planner/components/PlannerRecipeRail.tsx`
- Create: `apps/web/app/planner/Planner.module.css`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/planner.spec.ts`

**Interfaces:**
- Consumes: shared `PageShell` and row components.
- Produces: one bounded desktop workspace and the existing selected-day/stacked narrow layout.

- [ ] **Step 1: Update the failing desktop geometry test**

Assert the left edge matches the app shell, the recipe rail appears left of the board, there are seven day rows, board and rail bottom coordinates differ by at most one pixel, and page height/width do not overflow 1280×800.

- [ ] **Step 2: Run desktop Playwright and verify failure**

Run: `npm --workspace @cooking/web run test:e2e -- planner.spec.ts --project=desktop`

Expected: FAIL against the old seven-column geometry.

- [ ] **Step 3: Implement shared-height desktop layout**

Use a desktop grid with a 240–264px rail and flexible board. Set one workspace block-size and make the board `grid-template-rows: auto repeat(7, minmax(0, 1fr))`; make the rail a flex column whose recipe list alone scrolls.

- [ ] **Step 4: Preserve narrow-screen day layout**

Below the desktop breakpoint, disable the matrix, render the existing week strip/day sections, preserve touch targets, and avoid horizontal overflow.

- [ ] **Step 5: Run Planner verification**

Run: `npm --workspace @cooking/web test -- planner`

Run: `npm --workspace @cooking/web run test:e2e -- planner.spec.ts`

Expected: PASS on phone, tablet, and desktop.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/planner/page.tsx apps/web/app/planner/components/PlannerRecipeRail.tsx apps/web/app/planner/Planner.module.css apps/web/app/globals.css apps/web/e2e/planner.spec.ts
git commit -m "feat(planner): bound responsive weekly workspace"
```

### Task 3: Shopping presentation components

**Files:**
- Create: `apps/web/app/shopping-list/ShoppingSmartBar.tsx`
- Create: `apps/web/app/shopping-list/ShoppingCategorySection.tsx`
- Create: `apps/web/app/shopping-list/ShoppingItemRow.tsx`
- Create: `apps/web/app/shopping-list/ShoppingList.module.css`
- Create: `apps/web/app/shopping-list/ShoppingCategorySection.test.tsx`
- Modify: `apps/web/app/shopping-list/ProductPicks.tsx`
- Modify: `apps/web/app/shopping-list/ProductPicks.test.tsx`

**Interfaces:**
- `ShoppingSmartBar` receives counts, stale state, bulk state, and callbacks only.
- `ShoppingCategorySection` receives category rows and existing checked/product state maps.
- `ProductPicks` continues receiving loading/error/products/retry and renders vertical rows.

- [ ] **Step 1: Write failing product/category tests**

```tsx
expect(screen.getByRole("heading", { name: "Produce" })).toBeVisible();
expect(screen.queryByTestId("category-icon")).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "View products for Potatoes" }));
expect(screen.getAllByTestId("store-product-row")).toHaveLength(3);
```

Assert each product row has image, name, price, and safe external link; loading/error/retry stays inside the item.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm --workspace @cooking/web test -- ShoppingCategorySection.test.tsx ProductPicks.test.tsx`

Expected: FAIL because category components do not exist and current product layout differs.

- [ ] **Step 3: Implement category, grocery, and product rows**

Extract rendering without moving state ownership out of `page.tsx`. Category headers contain text and count only. `ProductPicks` uses a vertical list and `object-fit: contain` images.

- [ ] **Step 4: Implement compact smart bar**

Expose Smart mode, counts, Back to original, stale refresh, and Load all Weee picks without the large decorative hero.

- [ ] **Step 5: Run focused tests**

Run: `npm --workspace @cooking/web test -- ShoppingCategorySection.test.tsx ProductPicks.test.tsx productLoading.test.ts productLookupCoordinator.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/shopping-list/ShoppingSmartBar.tsx apps/web/app/shopping-list/ShoppingCategorySection.tsx apps/web/app/shopping-list/ShoppingItemRow.tsx apps/web/app/shopping-list/ShoppingList.module.css apps/web/app/shopping-list/ShoppingCategorySection.test.tsx apps/web/app/shopping-list/ProductPicks.tsx apps/web/app/shopping-list/ProductPicks.test.tsx
git commit -m "feat(shopping): add dense grocery and product rows"
```

### Task 4: Shopping page integration and responsive flow

**Files:**
- Modify: `apps/web/app/shopping-list/page.tsx`
- Modify: `apps/web/app/shopping-list/page.productLookup.test.tsx`
- Modify: `apps/web/e2e/shopping.spec.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: presentation components from Task 3.
- Preserves: refinement, local storage, checked/hidden, stale detection, bulk queue, lookup coordinator, and safe links.

- [ ] **Step 1: Update failing integration assertions**

Assert Prepare smart list is inside the preparation panel, refined mode uses the compact smart bar, categories use independently stacked desktop columns, and expanded products are vertical.

- [ ] **Step 2: Run and verify failure**

Run: `npm --workspace @cooking/web test -- page.productLookup.test.tsx`

Run: `npm --workspace @cooking/web run test:e2e -- shopping.spec.ts --project=desktop`

Expected: FAIL against the current hero/bento selectors.

- [ ] **Step 3: Integrate extracted components**

Keep all existing state and request functions in `page.tsx`, replace only the render structure, and migrate to `PageShell`. Use two independent columns on desktop and one column below 840px.

- [ ] **Step 4: Run full Shopping verification**

Run: `npm --workspace @cooking/web test -- shopping-list`

Run: `npm --workspace @cooking/web run test:e2e -- shopping.spec.ts`

Run: `npm --workspace @cooking/web run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/shopping-list/page.tsx apps/web/app/shopping-list/page.productLookup.test.tsx apps/web/e2e/shopping.spec.ts apps/web/app/globals.css
git commit -m "feat(shopping): align smart list workflow"
```

