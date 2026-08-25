# UI Reset: Native Mobile Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the native app with the approved Chef World system while preserving native navigation and the successful vertical phone workflows.

**Architecture:** Update shared tokens/primitives first, then migrate feature screens without copying desktop composition. Feature hooks, API clients, navigation types, storage, and backend contracts remain unchanged.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, TypeScript, React Navigation, Jest, Testing Library React Native.

**Spec:** `docs/superpowers/specs/2026-08-25-chef-world-cross-platform-ui-reset-design.md`

## Global Constraints

- Bottom tabs remain Library, Planner, Shopping.
- Import remains a native modal.
- Preserve safe areas, Dynamic Type, VoiceOver labels, and 44-point targets.
- No decorative Shopping category icons.
- Store products remain vertical.
- Import optional details are collapsed; review omits ingredient notes and step-image authoring.
- No servings UI and no API/model changes.

---

### Task 1: Mobile theme and primitives

**Files:**
- Modify: `apps/mobile/src/theme/colors.ts`
- Modify: `apps/mobile/src/theme/typography.ts`
- Modify: `apps/mobile/src/theme/spacing.ts`
- Modify: `apps/mobile/src/components/Card.tsx`
- Modify: `apps/mobile/src/components/Button.tsx`
- Modify: `apps/mobile/src/components/TextField.tsx`
- Test: `apps/mobile/src/components/Button.test.tsx`
- Test: `apps/mobile/src/components/SegmentedControl.test.tsx`

**Interfaces:**
- Produces the existing exported `colors`, `typography`, `spacing`, and component APIs with approved values/states.
- Later tasks consume the same names; no feature imports change.

- [ ] **Step 1: Add failing primitive-state assertions**

```tsx
expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
expect(screen.getByRole("button", { name: "Save" })).toHaveStyle({ minHeight: 44 });
```

Assert selected segmented-control state has more than color alone and disabled/loading buttons keep stable bounds.

- [ ] **Step 2: Run tests and verify failure where styles differ**

Run: `npm --workspace @cooking/mobile test -- Button.test.tsx SegmentedControl.test.tsx`

- [ ] **Step 3: Align shared tokens and primitives**

Use warm canvas/surface/ink/oxblood/olive roles, restrained 8–12px component radii, and Source Serif only for editorial titles. Preserve component signatures.

- [ ] **Step 4: Run primitive tests and typecheck**

Run: `npm --workspace @cooking/mobile test -- Button.test.tsx SegmentedControl.test.tsx IconButton.test.tsx`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme apps/mobile/src/components
git commit -m "feat(mobile): align shared visual primitives"
```

### Task 2: Mobile Library, Friends, detail, and Settings

**Files:**
- Modify: `apps/mobile/src/features/library/LibraryListScreen.tsx`
- Modify: `apps/mobile/src/features/library/FriendSearchScreen.tsx`
- Modify: `apps/mobile/src/features/library/FriendLibraryScreen.tsx`
- Modify: `apps/mobile/src/features/library/RecipeDetailScreen.tsx`
- Modify: `apps/mobile/src/features/profile/SettingsScreen.tsx`
- Test: `apps/mobile/src/features/profile/ProfileScreen.test.tsx`
- Create: `apps/mobile/src/features/library/LibraryListScreen.test.tsx`

**Interfaces:**
- Consumes shared mobile primitives.
- Preserves current navigation routes and copy endpoints.

- [ ] **Step 1: Write failing Library metadata tests**

```tsx
expect(screen.getByText("35 min")).toBeTruthy();
expect(screen.queryByText(/pieces/i)).toBeNull();
expect(screen.queryByText(/ingredients:/i)).toBeNull();
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm --workspace @cooking/mobile test -- LibraryListScreen.test.tsx`

- [ ] **Step 3: Apply approved screen grammar**

Keep Mine/Public/Friends navigation native, use title/time/tags cards, remove preemptive friend exact-email explanation, keep result-state privacy guidance, remove servings from detail, and align Settings sections.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm --workspace @cooking/mobile test -- LibraryListScreen.test.tsx ProfileScreen.test.tsx`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/library apps/mobile/src/features/profile/SettingsScreen.tsx
git commit -m "feat(mobile): align library and account screens"
```

### Task 3: Mobile Planner and Shopping

**Files:**
- Modify: `apps/mobile/src/features/planner/PlannerWeekScreen.tsx`
- Modify: `apps/mobile/src/features/planner/DayCard.tsx`
- Modify: `apps/mobile/src/features/planner/SlotRow.tsx`
- Modify: `apps/mobile/src/features/shopping/ShoppingListScreen.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListCard.tsx`
- Modify: `apps/mobile/src/features/shopping/SmartListItem.tsx`
- Modify: `apps/mobile/src/features/shopping/StoreProductPicks.tsx`
- Test: `apps/mobile/src/features/shopping/StoreProductPicks.test.tsx`

**Interfaces:**
- Preserves Planner week hooks and Shopping storage/product-cache hooks.
- Produces text-only category headers and vertical product rows.

- [ ] **Step 1: Update failing Shopping assertions**

```tsx
expect(screen.getByText("Produce")).toBeTruthy();
expect(screen.queryByTestId("category-icon")).toBeNull();
expect(screen.getAllByLabelText(/View .* on Weee/)).toHaveLength(3);
```

- [ ] **Step 2: Run and verify failure**

Run: `npm --workspace @cooking/mobile test -- StoreProductPicks.test.tsx`

- [ ] **Step 3: Align Planner without changing its native model**

Keep the week strip and selected-day vertical sections. Apply the one/two/three/overflow meal hierarchy in phone-appropriate rows and preserve picker-sheet behavior.

- [ ] **Step 4: Keep Shopping close to the original**

Remove category icon circles, tighten category/card spacing, retain vertical expanded product cards, and use a compact smart-mode header. Preserve bulk loading, checked items, local retry, and store links.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm --workspace @cooking/mobile test -- StoreProductPicks.test.tsx storage.test.ts useStoreProductsCache.test.ts`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/planner apps/mobile/src/features/shopping
git commit -m "feat(mobile): refine planner and shopping screens"
```

### Task 4: Mobile Source → Review import flow

**Files:**
- Modify: `apps/mobile/src/features/import/ImportModalScreen.tsx`
- Modify: `apps/mobile/src/features/import/ImportSourceTabs.tsx`
- Modify: `apps/mobile/src/features/import/LinkInputForm.tsx`
- Modify: `apps/mobile/src/features/import/TranscriptInputForm.tsx`
- Modify: `apps/mobile/src/features/import/DraftRecipeEditor.tsx`
- Modify: `apps/mobile/src/features/import/IngredientList.tsx`
- Modify: `apps/mobile/src/features/import/StepListEditor.tsx`
- Create: `apps/mobile/src/features/import/ImportModalScreen.test.tsx`

**Interfaces:**
- Preserves reducer phases `input` and `draft` and existing parse/create calls.
- Produces collapsed optional details and approved review fields.

- [ ] **Step 1: Write failing flow tests**

```tsx
expect(screen.queryByLabelText("Title (optional)")).toBeNull();
fireEvent.press(screen.getByText("Optional details"));
expect(screen.getByLabelText("Title (optional)")).toBeTruthy();
expect(screen.queryByText("Add step image")).toBeNull();
expect(screen.queryByLabelText("Ingredient notes")).toBeNull();
```

- [ ] **Step 2: Run and verify failure**

Run: `npm --workspace @cooking/mobile test -- ImportModalScreen.test.tsx`

- [ ] **Step 3: Implement the mobile import phases**

Keep the native modal, navigation Cancel/Save, and reducer. Collapse title/notes/tags in input. In review, keep image, title, description, total time, amount/name ingredient editing, text steps, tips, equipment, and tags. Remove step-image and ingredient-notes authoring controls without dropping hidden payload fields.

- [ ] **Step 4: Run mobile verification**

Run: `npm --workspace @cooking/mobile test -- ImportModalScreen.test.tsx`

Run: `npm --workspace @cooking/mobile test`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/import
git commit -m "feat(mobile): focus import source and review flow"
```

### Task 5: Cross-platform final verification

**Files:**
- Modify when behavior changed: `CLAUDE.md`
- Modify governed screenshots only after inspection: `apps/web/e2e/__screenshots__/**`

**Interfaces:**
- Consumes all four implementation plans.
- Produces a buildable, tested cross-platform UI reset.

- [ ] **Step 1: Run all unit and type verification**

Run: `npm run tokens:test`

Run: `npm run tokens:build`

Run: `npm run test:web`

Run: `npm run test:mobile`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npx tsc -p apps/mobile/tsconfig.json --noEmit`

- [ ] **Step 2: Run production and browser verification**

Run: `npm run web:build`

Run: `npm --workspace @cooking/web run test:e2e`

Expected: all commands exit zero.

- [ ] **Step 3: Inspect screenshots and update documentation**

Inspect Library/Friends, detail, Import, Planner, Shopping, and shell screenshots at original resolution in English and Chinese representative states. Update `CLAUDE.md` only where the user-visible route behavior or file layout changed.

- [ ] **Step 4: Commit final verification artifacts**

```bash
git add CLAUDE.md apps/web/e2e
git commit -m "test(ui): verify cross-platform interface reset"
```
