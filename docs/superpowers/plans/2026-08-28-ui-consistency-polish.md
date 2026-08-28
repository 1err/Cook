# Chef World UI Consistency Polish Implementation Plan

> **Revision — 2026-08-28:** The user restored the original native Library list (no inline search/tag toolbar) and the original two-column desktop Shopping categories (including while products are open). Tasks 2 and 3 below remain as implementation history and are superseded by this revision.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved cross-platform UI polish without changing product or backend behavior.

**Architecture:** Keep the existing page and navigation structures. Add only local state and responsive styles at the owning surfaces, reuse shared recipe-tag data, and protect each visible behavior with component or browser tests before implementation.

**Tech Stack:** Next.js 14, React 18, CSS Modules, React Native/Expo, Vitest/Testing Library, Jest/RNTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-ui-consistency-polish-design.md`

## Global Constraints

- No backend, API-contract, scraper, cache, meal-plan, or import-parser changes.
- Inter is the product/navigation heading family; Source Serif 4 remains only for recipe-specific editorial titles.
- Web responsive navigation must overlay content instead of changing header height.
- Mobile Library uses the original My/Public collection list without an inline search/tag toolbar.
- Shopping retains two compact desktop columns whether product panels are closed or open, and one column on phones.
- Existing English/Chinese, accessibility, and touch-target behavior must remain intact.

---

### Task 1: Product typography and authentication brand lockup

**Files:**
- Modify: `apps/mobile/src/theme/typography.ts`
- Modify: `apps/web/app/components/AuthShell.tsx`
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/app/components/AuthShell.test.tsx`
- Modify: `apps/mobile/src/features/profile/DesignSystemScreen.tsx` only if its typography preview labels become inaccurate

**Interfaces:**
- Consumes: existing `typography` token object and `/brand/chef-world-mark.svg`.
- Produces: Inter-backed `largeTitle`, `title1`, and `title2`; Source Serif-backed `recipeTitle`; `.auth-panel__brand` visible only below 1024px.

- [x] **Step 1: Write the failing web auth-shell test**

```tsx
render(<AuthShell title="Welcome back" subtitle="" eyebrow="">Form</AuthShell>);
expect(screen.getByLabelText("Chef World")).toBeInTheDocument();
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm --workspace @cooking/web test -- AuthShell.test.tsx`

Expected: FAIL because the auth panel has no labelled compact brand lockup.

- [x] **Step 3: Add the compact auth brand and narrow typography roles**

Add a panel brand using the existing SVG and wordmark, hidden at desktop widths where `.auth-hero__brand` is visible. Change only mobile product title tokens to Inter:

```ts
largeTitle: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
title1: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
title2: { fontSize: 22, fontFamily: "Inter_600SemiBold" },
recipeTitle: { fontSize: 28, fontFamily: "SourceSerif4_600SemiBold", letterSpacing: 0.1 },
```

- [x] **Step 4: Run focused tests and type-check**

Run: `npm --workspace @cooking/web test -- AuthShell.test.tsx`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

### Task 2: Honest mobile Library search and filtering

**Files:**
- Modify: `apps/mobile/src/navigation/stacks/LibraryStack.tsx`
- Modify: `apps/mobile/src/features/library/LibraryListScreen.tsx`
- Modify: `apps/mobile/src/features/library/LibraryListScreen.test.tsx`

**Interfaces:**
- Consumes: `RECIPE_TAG_GROUPS`, `TAG_LABELS`, `getRecipeTags`, `TextField`.
- Produces: local `search: string`, `tagFilter: "all" | RecipeTagSlug`, and a filtered/sorted list for the active Library collection.

- [x] **Step 1: Add failing tests for recipe filtering**

In `LibraryListScreen.test.tsx`, enter `tofu`, verify nonmatching recipes disappear, select a tag chip, and verify only recipes containing that tag remain. The people icon is a direct visual correction and does not receive a change-detector test.

- [x] **Step 2: Run the mobile tests and verify RED**

Run: `npm --workspace @cooking/mobile test -- LibraryListScreen.test.tsx MainTabs.test.tsx --runInBand`

Expected: FAIL because the Library has no title search/tag controls.

- [x] **Step 3: Implement minimal Library controls**

Add the shared `TextField` and horizontally scrolling tag chips beneath the My/Public segmented control. Apply title and single-tag filtering in one `useMemo`, sorting the result without mutating API arrays. Use `people-outline` for friend search.

- [x] **Step 4: Run focused tests and mobile type-check**

Run: `npm --workspace @cooking/mobile test -- LibraryListScreen.test.tsx MainTabs.test.tsx --runInBand`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

### Task 3: Full-width Shopping product expansion

**Files:**
- Modify: `apps/web/app/shopping-list/page.tsx`
- Modify: `apps/web/app/shopping-list/ShoppingList.module.css`
- Modify: `apps/web/e2e/shopping.spec.ts`

**Interfaces:**
- Consumes: `openProductsByIngredient: Record<string, boolean>`.
- Produces: `hasOpenProductPanel: boolean` and `.categoryGridExpanded`.

- [x] **Step 1: Add a failing rendered-layout assertion**

After opening `View products`, assert that the category container reports one column and that its expanded section is wider than 90% of the container.

- [x] **Step 2: Run the focused desktop test and verify RED**

Run: `npm --workspace @cooking/web run test:e2e -- shopping.spec.ts --project=desktop`

Expected: FAIL because `.categoryGrid` remains a two-column masonry container.

- [x] **Step 3: Implement the conditional layout**

Derive `Object.values(openProductsByIngredient).some(Boolean)` during render and append `.categoryGridExpanded`. Keep `columns: 2` by default; use `columns: 1` for the expanded state. Retain the existing mobile single column.

- [x] **Step 4: Re-run Shopping component and E2E tests**

Run: `npm --workspace @cooking/web test -- ProductPicks.test.tsx ShoppingCategorySection.test.tsx page.productLookup.test.tsx`

Run: `npm --workspace @cooking/web run test:e2e -- shopping.spec.ts --project=desktop --project=phone`

Expected: PASS with no horizontal overflow.

### Task 4: Responsive web navigation overlay

**Files:**
- Modify: `apps/web/app/components/Header.module.css`
- Modify: `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: existing `mobileMenuOpen`, `.navOpen`, and header shell tokens.
- Produces: an absolutely positioned responsive menu anchored beneath the header inner shell.

- [x] **Step 1: Add a failing header-height behavior test**

At phone/tablet viewport, measure `header.getBoundingClientRect().height`, open the navigation menu, and assert the height changes by at most one pixel while all four links remain visible.

- [x] **Step 2: Run phone/tablet shell tests and verify RED**

Run: `npm --workspace @cooking/web run test:e2e -- shell.spec.ts --project=phone --project=tablet`

Expected: FAIL because the in-flow second grid row increases header height.

- [x] **Step 3: Implement the overlay styling**

Make `.inner` the positioning anchor and render `.nav` as an absolute surface below it at widths up to 840px. Add a divider border, card radius, surface background, and overlay elevation; keep 44px link targets and existing active-state semantics.

- [x] **Step 4: Re-run shell tests**

Run: `npm --workspace @cooking/web test -- Header.test.tsx`

Run: `npm --workspace @cooking/web run test:e2e -- shell.spec.ts --project=desktop --project=phone --project=tablet`

Expected: behavior and Axe checks pass; update only intentional logo/menu snapshots after inspecting diffs.

### Task 5: Persistent long-form actions and safer recipe-detail hierarchy

**Files:**
- Modify: `apps/web/app/library/[id]/RecipeEdit.module.css`
- Modify: `apps/web/app/import/ImportFlow.module.css`
- Modify: `apps/web/app/recipe/[id]/page.tsx`
- Modify: `apps/web/app/recipe/[id]/RecipeDetail.module.css`
- Modify: `apps/web/app/recipe/[id]/page.test.tsx`
- Modify: `apps/web/e2e/recipe-workflow.spec.ts`
- Modify: `apps/web/e2e/import.spec.ts`

**Interfaces:**
- Consumes: existing `handleDelete`, Save/Cancel actions, and `RecipeCookAction`.
- Produces: sticky form headers under the global header and a labelled `More recipe actions` disclosure containing Delete.

- [x] **Step 1: Add failing detail and scroll-reachability tests**

In the unit test, assert Delete is not exposed as a peer action until `More recipe actions` is opened. In E2E tests, scroll the recipe editor and import review to the bottom and assert Save remains within the viewport.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm --workspace @cooking/web test -- 'app/recipe/[id]/page.test.tsx'`

Run: `npm --workspace @cooking/web run test:e2e -- recipe-workflow.spec.ts import.spec.ts --project=desktop`

Expected: FAIL because Delete is a top-level button and form actions scroll away.

- [x] **Step 3: Implement the action hierarchy**

Keep `RecipeCookAction` primary, make Edit and Planner secondary, and place Delete inside an accessible overflow disclosure. Make `.pageHeader` and `.reviewHeader` sticky below `--app-header-height`, with an opaque canvas background and restrained divider so form controls never show through.

- [x] **Step 4: Re-run focused tests**

Run the same Vitest and E2E commands from Step 2.

Expected: PASS, with Delete still requiring the existing confirmation.

### Task 6: Cross-platform regression and rendered QA

**Files:**
- Modify only intentional Playwright baselines under `apps/web/e2e/__screenshots__/` after inspecting diffs.
- Do not create reports, screenshots, or scripts in the source tree.

**Interfaces:**
- Consumes: all five completed slices.
- Produces: verified desktop and phone UI with current visual baselines.

- [x] **Step 1: Run unit, type, and build checks**

Run: `npm run test:web`

Run: `npm run test:mobile -- --runInBand`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Run: `npm --workspace @cooking/web run build`

- [x] **Step 2: Run targeted desktop and phone E2E suites**

Run: `npm --workspace @cooking/web run test:e2e -- shell.spec.ts library.spec.ts planner.spec.ts shopping.spec.ts recipe-workflow.spec.ts import.spec.ts --project=desktop --project=phone`

- [x] **Step 3: Review React performance and component boundaries**

Confirm no new request waterfalls, inline component definitions, unnecessary effects, duplicated global listeners, or mutable list sorting were introduced.

- [x] **Step 4: Verify rendered flows through the Browser plugin**

Flow: authenticated fixture shell → responsive menu → Library search/filter → Shopping product expansion → recipe detail overflow → long editor/review sticky actions. Check page identity, nonblank DOM, overlays, console logs, screenshots, and one interaction per changed surface at desktop and 390px width.
