# Cross-Platform Cook Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consistent Cook destination on web and native mobile where users create or resume one multi-dish session, advance hands-on steps, operate passive timers, and see time-weighted progress.

**Architecture:** Both clients consume the typed cooking API and shared pure calculations from the domain checkpoint. Each platform owns only view focus and online interaction state; canonical session state remains server-owned. The web uses a focus pane plus stable dish rail, while mobile uses a horizontally accessible dish switcher and persistent timer tray.

**Tech Stack:** Next.js 14 App Router, React 18, CSS Modules, React Native 0.81/Expo 54, React Navigation, shared i18n/types, Vitest/Testing Library, Jest/RNTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-cross-platform-guided-cooking-sessions-design.md`

## Global Constraints

- Primary destination order is Library, Planner, Cook, Shopping; Library remains the authenticated landing destination.
- Empty Cook can start from a selected planner date/meal or from any owned recipes.
- One active account session may contain multiple dishes; focus remains local to the device.
- Hands-on steps have no countdown; passive steps require explicit timer start and explicit completion.
- Timer expiry displays `Needs attention` and never resolves the step.
- Every dish remains visible with title, current step, timer/attention status, and time-weighted percentage.
- Existing step images render first; missing/broken images use the shared action illustration.
- All new UI uses current design tokens/components and route-local CSS modules, never new global route styling.
- English and Chinese copy, 44px/44pt targets, keyboard/assistive switching, reduced motion, and Dynamic Type are required.

---

### Task 1: Web Cook navigation and authenticated route shell

**Files:**
- Modify: `apps/web/app/components/Header.tsx`
- Modify: `apps/web/app/components/Header.test.tsx`
- Create: `apps/web/app/cook/page.tsx`
- Create: `apps/web/app/cook/CookPage.module.css`
- Create: `apps/web/app/cook/CookScreen.tsx`
- Create: `apps/web/app/cook/CookScreen.test.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces authenticated `/cook` route and fourth primary web link.
- Produces `CookScreen` state boundary that renders loading, retryable error, setup, or active workspace.

- [ ] **Step 1: Add failing header and route-state tests**

```tsx
test("places Cook between Planner and Shopping", () => {
  render(<Header />);
  const links = within(screen.getByRole("navigation", { name: "Main" }))
    .getAllByRole("link").map(link => link.textContent);
  expect(links).toEqual(["Library", "Planner", "Cook", "Shopping"]);
});

test("loads the active cooking session on entry", async () => {
  mockCookingActive.mockResolvedValue(null);
  render(<CookScreen />);
  expect(await screen.findByRole("heading", { name: "Start cooking" })).toBeVisible();
  expect(mockCookingActive).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run focused web tests and verify RED**

Run: `npm --workspace @cooking/web test -- Header.test.tsx CookScreen.test.tsx`

Expected: FAIL because the link/route does not exist.

- [ ] **Step 3: Add the link, route shell, localized states, and modular layout tokens**

The route wraps `CookScreen` in `RequireAuth` and `PageShell`. The screen uses `apiClient.cooking.active()` through a small controller hook introduced in Task 3, but initially may accept an injected loader in tests. Do not add Cook rules to `globals.css`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm --workspace @cooking/web test -- Header.test.tsx CookScreen.test.tsx && npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/Header.tsx apps/web/app/components/Header.test.tsx apps/web/app/cook packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): add web Cook destination"
```

---

### Task 2: Web planned/manual session setup

**Files:**
- Create: `apps/web/app/cook/CookSetup.tsx`
- Create: `apps/web/app/cook/CookSetup.test.tsx`
- Create: `apps/web/app/cook/cookSetupModel.ts`
- Create: `apps/web/app/cook/cookSetupModel.test.ts`
- Modify: `apps/web/app/cook/CookPage.module.css`
- Modify: `apps/web/app/cook/CookScreen.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Consumes: `recipes.list`, `mealPlan.list`, and `cooking.create`.
- Produces: `CookSetup({ onSessionCreated })` with planned date/meal preselection and searchable owned-recipe selection.

- [ ] **Step 1: Write failing setup-model and component tests**

```ts
test("preselects the chosen meal without duplicating recipe ids", () => {
  expect(getPlannedSelection(planFixture(), "2026-08-27", "dinner"))
    .toEqual(["rice", "tofu"]);
});
```

```tsx
test("switches from a planned meal to manual recipe selection", async () => {
  render(<CookSetup onSessionCreated={onCreated} />);
  await user.click(await screen.findByRole("button", { name: "Choose recipes" }));
  await user.click(screen.getByRole("checkbox", { name: "Mapo tofu" }));
  await user.click(screen.getByRole("button", { name: "Start 1 dish" }));
  expect(mockCreate).toHaveBeenCalledWith(["mapo"]);
});

test("offers Resume and Discard when creation conflicts with another device", async () => {
  mockCreate.mockRejectedValue(apiConflict("active_session_exists"));
  render(<CookSetup onSessionCreated={onCreated} />);
  // select and submit
  expect(await screen.findByRole("dialog", { name: "Cooking already in progress" })).toBeVisible();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --workspace @cooking/web test -- cookSetupModel.test.ts CookSetup.test.tsx`

Expected: FAIL because setup files do not exist.

- [ ] **Step 3: Implement planned and manual selection**

Use an ISO date input, Breakfast/Lunch/Dinner segmented buttons, recipe cards with checkboxes, search, clear selection, and a single start button. Disable start when no recipes are selected. If a selected recipe has no steps, link to `/recipe/{id}/tutorial/edit` rather than submitting it.

- [ ] **Step 4: Implement active-session conflict choices**

Resume fetches `cooking.active()` and opens it. Discard confirms, calls `cooking.discard(active.id)`, and retries creation once. Keep network errors local to setup.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm --workspace @cooking/web test -- cookSetupModel.test.ts CookSetup.test.tsx && npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/cook packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): start sessions from plans or recipes"
```

---

### Task 3: Web online session controller and active workspace

**Files:**
- Create: `apps/web/app/cook/useCookingSession.ts`
- Create: `apps/web/app/cook/useCookingSession.test.tsx`
- Create: `apps/web/app/cook/CookWorkspace.tsx`
- Create: `apps/web/app/cook/CookWorkspace.test.tsx`
- Create: `apps/web/app/cook/DishRail.tsx`
- Create: `apps/web/app/cook/FocusedCookingStep.tsx`
- Create: `apps/web/app/cook/CookingTimer.tsx`
- Create: `apps/web/app/cook/cookingTime.ts`
- Create: `apps/web/app/cook/cookingTime.test.ts`
- Modify: `apps/web/app/cook/CookScreen.tsx`
- Modify: `apps/web/app/cook/CookPage.module.css`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces: `useCookingSession()` with canonical session, selected dish ID, online mutation methods, and focused refresh.
- Produces: focus pane, stable dish rail, timer ring, compact timers, recommendation summary, and destructive controls.

- [ ] **Step 1: Write failing time and controller tests with a fake clock**

```ts
test("formats an absolute timer without accumulating interval drift", () => {
  expect(getRemainingSeconds("2026-08-27T00:10:00Z", Date.parse("2026-08-27T00:08:29.500Z")))
    .toBe(91);
});

test("posts the focused step revision and replaces optimistic state with canonical response", async () => {
  const { result } = renderHook(() => useCookingSession(), { wrapper });
  await act(() => result.current.complete("dish-1", "step-1"));
  expect(mockAction).toHaveBeenCalledWith(
    "session-1", "step-1", expect.objectContaining({ action: "complete", expected_revision: 2 }),
  );
  expect(result.current.session).toEqual(serverResponse);
});
```

- [ ] **Step 2: Run focused controller tests and verify RED**

Run: `npm --workspace @cooking/web test -- cookingTime.test.ts useCookingSession.test.tsx`

Expected: FAIL because helpers/controller do not exist.

- [ ] **Step 3: Implement the online controller**

Generate a stable random browser device ID in user-scoped storage. On each action, create a mutation UUID and ISO occurrence time, apply shared optimistic state, call the API, then replace with canonical response. On errors, restore the prior snapshot and expose a localized inline error. Refresh on window focus and every five seconds only while `/cook` is visible.

- [ ] **Step 4: Write failing workspace interaction tests**

```tsx
test("hands-on work has no countdown and advances explicitly", async () => {
  render(<CookWorkspace controller={controllerFixture({ attention: "hands_on" })} />);
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Complete step" }));
  expect(controller.complete).toHaveBeenCalled();
});

test("passive work starts, pauses, resumes, extends, and still requires completion", async () => {
  render(<CookWorkspace controller={controllerFixture({ attention: "passive" })} />);
  await user.click(screen.getByRole("button", { name: "Start timer" }));
  expect(controller.startTimer).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Complete step" })).toBeVisible();
});

test("keeps every dish visible and changes focus without reordering", async () => {
  render(<CookWorkspace controller={multiDishController()} />);
  expect(screen.getAllByTestId("dish-rail-item").map(item => item.textContent)).toEqual(expect.arrayContaining(["Rice", "Tofu"]));
  await user.click(screen.getByRole("button", { name: /Focus Rice/ }));
  expect(screen.getByRole("heading", { name: "Rice" })).toBeVisible();
});
```

- [ ] **Step 5: Implement focus pane, dish rail, timer controls, progress, and recommendation summary**

Use `RecipeStepIllustration` when `image_url` is absent or broken. Announce only transition events through a polite live region. Preserve dish order; use badges and text for priority. Responsive CSS changes the rail to an accessible horizontal switcher without hiding dish status.

- [ ] **Step 6: Implement skip, reopen, undo window, add/remove dish, finish, and discard**

Undo stores the last completed/skipped step for ten seconds and calls `reopen`. Removing a progressed/active dish requires a named confirmation. Finish is enabled only when shared state reports every dish complete. Adding dishes reopens the manual selector in add mode.

- [ ] **Step 7: Run focused web Cook tests and typecheck**

Run: `npm --workspace @cooking/web test -- CookScreen.test.tsx CookSetup.test.tsx CookWorkspace.test.tsx useCookingSession.test.tsx cookingTime.test.ts`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/cook packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): add web guided cooking workspace"
```

---

### Task 4: Web recipe-detail entry points

**Files:**
- Create: `apps/web/app/recipe/[id]/RecipeCookAction.tsx`
- Create: `apps/web/app/recipe/[id]/RecipeCookAction.test.tsx`
- Modify: `apps/web/app/recipe/[id]/page.tsx`
- Modify: `apps/web/app/recipe/[id]/page.test.tsx`
- Modify: `apps/web/app/recipe/[id]/RecipeDetail.module.css`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces correct CTA: `Start cooking`, `Add to current session`, `Open in Cook`, or `Edit tutorial`.

- [ ] **Step 1: Write failing CTA state tests**

```tsx
test.each([
  [null, false, "Edit tutorial"],
  [null, true, "Start cooking"],
  [sessionWithoutRecipe, true, "Add to current session"],
  [sessionWithRecipe, true, "Open in Cook"],
])("renders the correct action", async (session, hasSteps, label) => {
  render(<RecipeCookAction recipe={recipeFixture({ hasSteps })} initialSession={session} />);
  expect(screen.getByRole("link", { name: label })).toBeVisible();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --workspace @cooking/web test -- RecipeCookAction.test.tsx page.test.tsx`

Expected: FAIL because the CTA component does not exist.

- [ ] **Step 3: Implement CTA behavior and local conflict/error states**

Start creates a one-recipe session and navigates to `/cook`. Add calls `addDishes`; Open links to `/cook?dish={dishId}`. No-step recipes link to the existing focused tutorial editor.

- [ ] **Step 4: Run recipe and Cook tests**

Run: `npm --workspace @cooking/web test -- RecipeCookAction.test.tsx page.test.tsx CookScreen.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/recipe packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): enter sessions from web recipes"
```

---

### Task 5: Mobile Cook tab and navigation shell

**Files:**
- Create: `apps/mobile/src/navigation/stacks/CookStack.tsx`
- Create: `apps/mobile/src/features/cook/CookScreen.tsx`
- Create: `apps/mobile/src/features/cook/CookScreen.test.tsx`
- Modify: `apps/mobile/src/navigation/MainTabs.tsx`
- Modify: `apps/mobile/src/navigation/MainTabs.test.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces `CookStackParamList` and a Cook tab between Planner and Shopping.
- Preserves Library as the first tab and initial authenticated destination.

- [ ] **Step 1: Add failing four-tab order and screen-state tests**

```ts
expect(MAIN_TAB_DEFINITIONS.map(({ name }) => name)).toEqual([
  "Library", "Planner", "Cook", "Shopping",
]);
```

```tsx
test("loads the active account session when Cook gains focus", async () => {
  mockActive.mockResolvedValue(null);
  renderScreen(<CookScreen navigation={navigation} route={route} />);
  expect(await screen.findByText("Start cooking")).toBeTruthy();
});
```

- [ ] **Step 2: Run focused mobile tests and verify RED**

Run: `npm --workspace @cooking/mobile test -- MainTabs.test.tsx CookScreen.test.tsx`

Expected: FAIL because Cook navigation does not exist.

- [ ] **Step 3: Add the stack, fourth tab, localized title, and state shell**

Use the existing core stack options and design tokens. Keep the Cook screen mounted like other tabs but refresh it through navigation focus events.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm --workspace @cooking/mobile test -- MainTabs.test.tsx CookScreen.test.tsx && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/navigation apps/mobile/src/features/cook packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): add native Cook tab"
```

---

### Task 6: Mobile session setup and controller

**Files:**
- Create: `apps/mobile/src/features/cook/CookSetup.tsx`
- Create: `apps/mobile/src/features/cook/CookSetup.test.tsx`
- Create: `apps/mobile/src/features/cook/useCookingSession.ts`
- Create: `apps/mobile/src/features/cook/useCookingSession.test.tsx`
- Modify: `apps/mobile/src/features/cook/CookScreen.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Consumes the same typed API and shared setup semantics as web.
- Produces planner/manual selection, active conflict resolution, focus refresh, polling, optimistic online actions, and local focus.

- [ ] **Step 1: Write failing setup and controller tests**

```tsx
test("starts all recipes in a selected planner meal", async () => {
  renderCookSetup();
  fireEvent.press(await screen.findByText("Dinner"));
  fireEvent.press(screen.getByText("Start 2 dishes"));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(["rice", "tofu"]));
});

test("refreshes on focus and polls only while focused", async () => {
  const { unmount } = renderHookWithNavigation(() => useCookingSession());
  expect(mockActive).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(5_000);
  expect(mockActive).toHaveBeenCalledTimes(2);
  unmount();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --workspace @cooking/mobile test -- CookSetup.test.tsx useCookingSession.test.tsx`

Expected: FAIL because setup/controller files do not exist.

- [ ] **Step 3: Implement setup UI and online controller**

Use native date controls available without new dependencies, meal segmented controls, searchable recipe rows, and a bottom CTA. The controller mirrors web request payloads and optimistic replacement, using AsyncStorage for its user-scoped device ID.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm --workspace @cooking/mobile test -- CookSetup.test.tsx useCookingSession.test.tsx && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/cook packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): create and sync native sessions"
```

---

### Task 7: Mobile active cooking workspace and recipe entry

**Files:**
- Create: `apps/mobile/src/features/cook/CookWorkspace.tsx`
- Create: `apps/mobile/src/features/cook/CookWorkspace.test.tsx`
- Create: `apps/mobile/src/features/cook/DishSwitcher.tsx`
- Create: `apps/mobile/src/features/cook/FocusedCookingStep.tsx`
- Create: `apps/mobile/src/features/cook/CookingTimerRing.tsx`
- Create: `apps/mobile/src/features/cook/TimerTray.tsx`
- Create: `apps/mobile/src/features/library/RecipeCookAction.tsx`
- Create: `apps/mobile/src/features/library/RecipeCookAction.test.tsx`
- Modify: `apps/mobile/src/features/library/RecipeDetailScreen.tsx`
- Modify: `apps/mobile/src/features/library/RecipeDetailScreen.test.tsx`
- Modify: `apps/mobile/src/features/cook/CookScreen.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces accessible dish switcher, focused step, timer controls/ring, persistent timer tray, recommendation summary, and recipe entry CTA.

- [ ] **Step 1: Write failing interaction, ergonomics, and CTA tests**

```tsx
test("keeps all running timers in the bottom tray while another dish is focused", () => {
  renderWorkspace(multiDishFixture());
  expect(screen.getByLabelText("Rice timer, 8 minutes remaining")).toBeTruthy();
  expect(screen.getByLabelText("Tofu needs attention")).toBeTruthy();
});

test("exposes at least 44 point actions and full accessibility labels", () => {
  renderWorkspace(multiDishFixture());
  expect(screen.getByLabelText("Complete step").props.style).toEqual(expect.arrayContaining([
    expect.objectContaining({ minHeight: 44 }),
  ]));
});

test("adds the current recipe to an existing session", async () => {
  renderRecipeCookAction(sessionWithoutRecipe);
  fireEvent.press(screen.getByText("Add to current session"));
  await waitFor(() => expect(mockAddDishes).toHaveBeenCalledWith("session-1", ["recipe-1"]));
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --workspace @cooking/mobile test -- CookWorkspace.test.tsx RecipeCookAction.test.tsx RecipeDetailScreen.test.tsx`

Expected: FAIL because workspace and CTA files do not exist.

- [ ] **Step 3: Implement the workspace and timer tray**

Use `FlatList` with explicit accessibility roles for dish switching; swipe is optional and never the only interaction. Use SVG for the calm timer ring and `RecipeStepIllustration` for image fallback. The tray respects safe-area bottom insets and exposes full titles/state labels when visual text truncates.

- [ ] **Step 4: Implement session controls and recipe-detail entry**

Mirror web: complete, skip, ten-second undo/reopen, add/remove, finish, discard, and correct recipe CTA state. Structural actions confirm when progress/timers would be removed.

- [ ] **Step 5: Run focused tests, full mobile suite, and typecheck**

Run: `npm --workspace @cooking/mobile test -- CookWorkspace.test.tsx RecipeCookAction.test.tsx RecipeDetailScreen.test.tsx`

Run: `npm --workspace @cooking/mobile test && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/cook apps/mobile/src/features/library packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): add native guided cooking workspace"
```

---

### Task 8: Cross-platform browser verification and documentation

**Files:**
- Create: `apps/web/e2e/cooking.spec.ts`
- Create: platform screenshots under `apps/web/e2e/__screenshots__/cooking.spec.ts/`
- Modify: `CLAUDE.md`

**Interfaces:**
- Verifies web browser flow against mocked authenticated API boundaries and documents both client surfaces.

- [ ] **Step 1: Add the failing Playwright cooking story**

The test must mock auth, recipes, meal-plan, and cooking-session routes, then verify: Library is the landing route; Cook is fourth navigation destination; planned selection starts two dishes; passive timer does not auto-complete; another dish stays visible; completion changes weighted progress; refresh restores canonical state; finish returns to setup; desktop/tablet/phone have no horizontal overflow; axe finds no serious/critical issues.

- [ ] **Step 2: Run the focused browser story and verify RED**

Run: `npm --workspace @cooking/web run test:e2e -- cooking.spec.ts`

Expected: FAIL before final selectors/screenshots are complete.

- [ ] **Step 3: Complete E2E selectors and stable screenshots**

Use role/test-id selectors only where semantic roles cannot distinguish repeated dish controls. Mask live countdown text for screenshots. Add Darwin and Linux baselines only from their respective environments.

- [ ] **Step 4: Update authoritative documentation**

Change the product summary from “no Cook surface” to the delivered web/mobile Cook experience. Document navigation, route files, online synchronization interval, device-local focus, timer semantics, and that offline queues/notifications arrive in the reliability checkpoint.

- [ ] **Step 5: Run the workspace checkpoint**

Run: `npm run test:web && npm run test:mobile`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Run: `npm run web:build`

Run: `npm --workspace @cooking/web run test:e2e -- cooking.spec.ts tutorial.spec.ts shell.spec.ts recipe-workflow.spec.ts`

Run: `git diff --check`

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e CLAUDE.md
git commit -m "test(cook): verify cross-platform workspaces"
```
