# Web Planner Viewport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete seven-day desktop planner fit within a 1280×800 viewport while preserving the saved-recipe rail, drag-and-drop, click-to-add, recipe opening, removal, and small-screen scrolling.

**Architecture:** Keep `page.tsx` as the API/state coordinator and extract focused planner presentation units. A pure model module owns immutable slot updates and the two-visible-recipe rule; the compact meal-slot component owns its overflow dialog; the week board, toolbar, and recipe rail only render data and raise callbacks.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Vitest, React Testing Library, Playwright, existing Chef World design tokens and CSS.

**Spec:** `docs/superpowers/specs/2026-08-15-web-planner-weee-cache-design.md`

## Global Constraints

- At desktop widths of 1280 pixels or greater and viewport heights of 800 pixels or greater, `/planner` must have no document-level vertical scroll.
- Keep the saved-recipe rail visible, independently scrollable, and usable by drag-and-drop on desktop.
- Render at most two recipe tiles per meal slot; expose additional recipes through an accessible `+N more` dialog.
- Preserve add, remove, open, week navigation, drag/drop, and click-to-add behavior.
- Restore the previous slot state and display a non-blocking error when a meal-plan write fails.
- Tablet and phone retain normal document scrolling and the current picker workflow.
- Use existing semantic design tokens; do not add raw color literals.
- Add English and Chinese copy together for every new translation key.

## File Structure

- `apps/web/app/planner/plannerModel.ts` — pure immutable slot updates and the two-visible-recipe split.
- `apps/web/app/planner/components/PlannerMealSlot.tsx` — compact tile rendering, add/remove/open actions, drag target, and overflow dialog.
- `apps/web/app/planner/components/PlannerWeekBoard.tsx` — seven dates by three meal slots; no API ownership.
- `apps/web/app/planner/components/PlannerToolbar.tsx` — title, week range, Shopping link, and week navigation.
- `apps/web/app/planner/components/PlannerRecipeRail.tsx` — fixed controls/footer around an internally scrolling recipe list.
- `apps/web/app/planner/page.tsx` — load state, filters, routing, drag data, picker state, and versioned optimistic persistence.
- `apps/web/app/globals.css` — desktop viewport contract and responsive fallback using the existing planner classes.
- `apps/web/e2e/planner.spec.ts` — deterministic 1280×800 layout and interaction acceptance.
- Colocated `*.test.ts(x)` files — pure/component regression coverage at each boundary.

---

### Task 1: Pure planner slot model

**Files:**
- Create: `apps/web/app/planner/plannerModel.ts`
- Test: `apps/web/app/planner/plannerModel.test.ts`

**Interfaces:**
- Consumes: `MealPlanSlots` and `MealType` from `@cooking/shared`.
- Produces: `MAX_VISIBLE_SLOT_RECIPES`, `splitSlotRecipeIds(recipeIds)`, `addRecipeToSlots(slots, slot, recipeId)`, and `removeRecipeFromSlots(slots, slot, recipeId)`.

- [ ] **Step 1: Write the failing model tests**

```ts
import { describe, expect, test } from "vitest";
import { emptyMealPlanSlots } from "@cooking/shared";
import {
  MAX_VISIBLE_SLOT_RECIPES,
  addRecipeToSlots,
  removeRecipeFromSlots,
  splitSlotRecipeIds,
} from "./plannerModel";

describe("plannerModel", () => {
  test("shows two recipes and reports the remaining overflow", () => {
    expect(MAX_VISIBLE_SLOT_RECIPES).toBe(2);
    expect(splitSlotRecipeIds(["r1", "r2", "r3", "r4"])).toEqual({
      visible: ["r1", "r2"],
      overflow: ["r3", "r4"],
    });
  });

  test("adds immutably and ignores a duplicate recipe", () => {
    const original = { ...emptyMealPlanSlots(), lunch: ["r1"] };
    const added = addRecipeToSlots(original, "lunch", "r2");
    expect(added.lunch).toEqual(["r1", "r2"]);
    expect(original.lunch).toEqual(["r1"]);
    expect(addRecipeToSlots(added, "lunch", "r2")).toBe(added);
  });

  test("removes only the requested recipe", () => {
    const original = { ...emptyMealPlanSlots(), dinner: ["r1", "r2"] };
    expect(removeRecipeFromSlots(original, "dinner", "r1").dinner).toEqual(["r2"]);
  });
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm --workspace @cooking/web test -- app/planner/plannerModel.test.ts`

Expected: FAIL because `./plannerModel` does not exist.

- [ ] **Step 3: Implement immutable planner helpers**

```ts
import type { MealPlanSlots, MealType } from "@cooking/shared";

export const MAX_VISIBLE_SLOT_RECIPES = 2;

export function splitSlotRecipeIds(recipeIds: readonly string[]) {
  return {
    visible: recipeIds.slice(0, MAX_VISIBLE_SLOT_RECIPES),
    overflow: recipeIds.slice(MAX_VISIBLE_SLOT_RECIPES),
  };
}

function cloneSlots(slots: MealPlanSlots): MealPlanSlots {
  return {
    breakfast: [...slots.breakfast],
    lunch: [...slots.lunch],
    dinner: [...slots.dinner],
  };
}

export function addRecipeToSlots(
  slots: MealPlanSlots,
  slot: MealType,
  recipeId: string,
): MealPlanSlots {
  if (slots[slot].includes(recipeId)) return slots;
  const next = cloneSlots(slots);
  next[slot] = [...next[slot], recipeId];
  return next;
}

export function removeRecipeFromSlots(
  slots: MealPlanSlots,
  slot: MealType,
  recipeId: string,
): MealPlanSlots {
  const next = cloneSlots(slots);
  next[slot] = next[slot].filter((id) => id !== recipeId);
  return next;
}
```

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `npm --workspace @cooking/web test -- app/planner/plannerModel.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the model boundary**

```bash
git add apps/web/app/planner/plannerModel.ts apps/web/app/planner/plannerModel.test.ts
git commit -m "test(planner): define compact slot model"
```

---

### Task 2: Compact meal slot and overflow dialog

**Files:**
- Create: `apps/web/app/planner/components/PlannerMealSlot.tsx`
- Test: `apps/web/app/planner/components/PlannerMealSlot.test.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Consumes: `splitSlotRecipeIds`, a `Record<string, Recipe | undefined>`, date, meal type, drag state, and callbacks.
- Produces: `PlannerMealSlot` with two compact visible tiles, `+N more`, an accessible overflow dialog, an empty add control, and drag/drop data attributes.

- [ ] **Step 1: Write failing component tests for compact, overflow, and focus behavior**

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { Recipe } from "@cooking/shared";
import { I18nProvider } from "../../lib/i18n";
import { PlannerMealSlot } from "./PlannerMealSlot";

const recipes: Record<string, Recipe> = Object.fromEntries(
  ["One", "Two", "Three"].map((title, index) => [
    `r${index + 1}`,
    { id: `r${index + 1}`, title, ingredients: [] },
  ]),
);

afterEach(cleanup);

function renderSlot(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

test("renders two compact recipes and an accessible overflow count", () => {
  renderSlot(
    <PlannerMealSlot
      date="2026-08-10"
      slot="dinner"
      recipeIds={["r1", "r2", "r3"]}
      recipesById={recipes}
      isDragOver={false}
      onChoose={vi.fn()}
      onOpen={vi.fn()}
      onRemove={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDrop={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Open One" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Two" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open Three" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show 1 more recipe for dinner on 2026-08-10" })).toBeVisible();
});

test("closes overflow with Escape and restores focus", async () => {
  const user = userEvent.setup();
  renderSlot(
    <PlannerMealSlot
      date="2026-08-10"
      slot="dinner"
      recipeIds={["r1", "r2", "r3"]}
      recipesById={recipes}
      isDragOver={false}
      onChoose={vi.fn()}
      onOpen={vi.fn()}
      onRemove={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDrop={vi.fn()}
    />,
  );
  const trigger = screen.getByRole("button", { name: /Show 1 more recipe/ });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "Dinner recipes for 2026-08-10" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("traps Tab inside the overflow dialog", async () => {
  const user = userEvent.setup();
  renderSlot(
    <PlannerMealSlot
      date="2026-08-10"
      slot="dinner"
      recipeIds={["r1", "r2", "r3"]}
      recipesById={recipes}
      isDragOver={false}
      onChoose={vi.fn()}
      onOpen={vi.fn()}
      onRemove={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDrop={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Show 1 more recipe/ }));
  const dialog = screen.getByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  buttons.at(-1)?.focus();
  await user.tab();
  expect(buttons[0]).toHaveFocus();
});
```

- [ ] **Step 2: Run the component test to verify RED**

Run: `npm --workspace @cooking/web test -- app/planner/components/PlannerMealSlot.test.tsx`

Expected: FAIL because `PlannerMealSlot` does not exist.

- [ ] **Step 3: Implement `PlannerMealSlot` with localized accessible labels**

Implement these exact props and behaviors:

```ts
export type PlannerMealSlotProps = {
  date: string;
  slot: MealType;
  recipeIds: string[];
  recipesById: Record<string, Recipe | undefined>;
  isDragOver: boolean;
  onChoose: () => void;
  onOpen: (recipeId: string) => void;
  onRemove: (recipeId: string) => void;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
};
```

Use trigger and dialog refs plus a `useEffect` keydown listener while the dialog is open. Escape closes the dialog and calls `triggerRef.current?.focus()`. Tab and Shift+Tab cycle between the dialog's first and last focusable controls. Render all recipe IDs inside the dialog with Open and Remove actions. The dialog backdrop closes on pointer click; the dialog panel stops propagation. Use `aria-modal="true"`, a date-and-meal accessible name, decorative recipe images with empty alt text, and the existing picker visual treatment. Put `data-testid="planner-meal-slot"`, `data-date`, and the slot index derived from `MEAL_PLAN_SLOTS.indexOf(slot)` on the drop-target root.

Use this complete Escape-and-focus helper inside the component:

```tsx
function useDialogKeyboard(
  overflowOpen: boolean,
  closeOverflow: () => void,
  overflowTriggerRef: React.RefObject<HTMLButtonElement>,
  dialogRef: React.RefObject<HTMLDivElement>,
) {
  useEffect(() => {
    if (!overflowOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverflow();
        queueMicrotask(() => overflowTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeOverflow, dialogRef, overflowOpen, overflowTriggerRef]);
}
```

Add these message keys to both locale files with equivalent Chinese copy:

```json
"planner.openRecipe": "Open {title}",
"planner.removeRecipeFromSlot": "Remove {title} from {slot} on {date}",
"planner.showMoreRecipes": "Show {count} more recipe for {slot} on {date}",
"planner.showMoreRecipesPlural": "Show {count} more recipes for {slot} on {date}",
"planner.slotRecipes": "{slot} recipes for {date}",
"planner.closeSlotRecipes": "Close meal recipes"
```

- [ ] **Step 4: Run component and message validation tests**

Run: `npm --workspace @cooking/web test -- app/planner/components/PlannerMealSlot.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the compact slot**

```bash
git add apps/web/app/planner/components/PlannerMealSlot.tsx apps/web/app/planner/components/PlannerMealSlot.test.tsx packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(planner): add compact meal slots"
```

---

### Task 3: Week board, toolbar, and persistent recipe rail

**Files:**
- Create: `apps/web/app/planner/components/PlannerToolbar.tsx`
- Create: `apps/web/app/planner/components/PlannerRecipeRail.tsx`
- Create: `apps/web/app/planner/components/PlannerWeekBoard.tsx`
- Test: `apps/web/app/planner/components/PlannerWeekBoard.test.tsx`

**Interfaces:**
- Consumes: page-owned data, filtering controls, source recipe nodes, week navigation callbacks, and meal-slot callbacks.
- Produces: a seven-column `PlannerWeekBoard`, one-row `PlannerToolbar`, and a persistent `PlannerRecipeRail` with fixed header/footer plus scrollable content.

- [ ] **Step 1: Write the failing week-board structure test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyMealPlanSlots } from "@cooking/shared";
import { I18nProvider } from "../../lib/i18n";
import { PlannerWeekBoard } from "./PlannerWeekBoard";

test("renders all seven days and 21 accessible meal slots", () => {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-08-${String(10 + index).padStart(2, "0")}`);
  const planByDate = Object.fromEntries(dates.map((date) => [date, emptyMealPlanSlots()]));
  render(
    <I18nProvider>
      <PlannerWeekBoard
        dates={dates}
        today="2026-08-10"
        planByDate={planByDate}
        recipesById={{}}
        draggingSlot={null}
        onChoose={vi.fn()}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
      />
    </I18nProvider>,
  );
  expect(screen.getAllByTestId("planner-day-column")).toHaveLength(7);
  expect(screen.getAllByTestId("planner-meal-slot")).toHaveLength(21);
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm --workspace @cooking/web test -- app/planner/components/PlannerWeekBoard.test.tsx`

Expected: FAIL because `PlannerWeekBoard` does not exist.

- [ ] **Step 3: Implement the three presentational components**

`PlannerToolbar` renders the localized planner title, formatted week range, Shopping link, and previous/next buttons in one row. `PlannerRecipeRail` accepts `controls`, `recipes`, and `footer` React nodes and renders them in fixed head, scroll body, and fixed foot regions. `PlannerWeekBoard` maps the seven dates and three `MEAL_PLAN_SLOTS`, adding `data-testid="planner-day-column"` and forwarding each slot to `PlannerMealSlot` with `data-testid="planner-meal-slot"` on the slot root.

Do not make API calls or own meal-plan state in these components.

Use this mapping structure in `PlannerWeekBoard`:

```tsx
return (
  <div className="planner-editorial__grid">
    {dates.map((date, dayIndex) => (
      <section key={date} data-testid="planner-day-column" className="planner-editorial__day-column">
        <header className={`planner-editorial__day-head${date === today ? " is-today" : ""}`}>
          <p className="dow font-headline">{COL_SHORT[dayIndex]}</p>
          <p className="dom">{dayOfMonth(date)}</p>
        </header>
        <div className="planner-editorial__day-body">
          {MEAL_PLAN_SLOTS.map((slot, slotIndex) => (
            <PlannerMealSlot
              key={slot}
              date={date}
              slot={slot}
              recipeIds={(planByDate[date] ?? emptyMealPlanSlots())[slot]}
              recipesById={recipesById}
              isDragOver={draggingSlot?.date === date && draggingSlot.slot === slot}
              onChoose={() => onChoose(date, slot)}
              onOpen={onOpen}
              onRemove={(recipeId) => onRemove(date, slot, recipeId)}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </div>
      </section>
    ))}
  </div>
);
```

- [ ] **Step 4: Run the focused test and TypeScript**

Run: `npm --workspace @cooking/web test -- app/planner/components/PlannerWeekBoard.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: focused test PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the planner presentation boundary**

```bash
git add apps/web/app/planner/components/PlannerToolbar.tsx apps/web/app/planner/components/PlannerRecipeRail.tsx apps/web/app/planner/components/PlannerWeekBoard.tsx apps/web/app/planner/components/PlannerWeekBoard.test.tsx
git commit -m "refactor(planner): split desktop presentation"
```

---

### Task 4: Integrate compact planner with reliable optimistic mutations

**Files:**
- Modify: `apps/web/app/planner/page.tsx`
- Test: `apps/web/app/planner/page.test.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Consumes: Tasks 1–3 components and model helpers.
- Produces: page-owned request state, versioned per-day optimistic writes, rollback, and a non-blocking `role="status"` error.

- [ ] **Step 1: Write a failing rollback regression test**

In `page.test.tsx`, mock `next/navigation`, `RequireAuth`, `useT`, and `apiFetch`. Return one recipe and an empty seven-day plan for GET requests. Return HTTP 500 for the first meal-plan PUT. Select the recipe through Monday dinner’s Choose button and assert the optimistic tile appears, then disappears after the rejected PUT while `screen.getByRole("status")` contains `Could not save your planner change. Your previous plan was restored.`

Use `userEvent.setup()`, `findByRole`, and `waitFor` so the test observes both optimistic and rolled-back states.

- [ ] **Step 2: Run the page test to verify RED**

Run: `npm --workspace @cooking/web test -- app/planner/page.test.tsx`

Expected: FAIL because failed writes currently leave the optimistic state in place.

- [ ] **Step 3: Integrate components and versioned rollback**

Replace the duplicated planner markup with `PlannerRecipeRail`, `PlannerToolbar`, and `PlannerWeekBoard`. Replace manual slot cloning with `addRecipeToSlots` and `removeRecipeFromSlots`.

Add this coordinator state:

```ts
const [mutationError, setMutationError] = useState<string | null>(null);
const mutationVersionByDate = useRef<Record<string, number>>({});
```

Make `putDay` throw on non-2xx and return normalized server slots. Route both add and remove through a `commitDayMutation(date, previous, next)` function that increments the date version, paints `next` immediately, and only applies the response or rollback when its version is still current. On failure, restore `previous` and set `planner.saveFailed`.

```ts
async function commitDayMutation(
  date: string,
  previous: MealPlanSlots,
  next: MealPlanSlots,
) {
  const version = (mutationVersionByDate.current[date] ?? 0) + 1;
  mutationVersionByDate.current[date] = version;
  setMutationError(null);
  setPlanByDate((current) => ({ ...current, [date]: next }));
  try {
    const saved = await putDay(date, next);
    if (mutationVersionByDate.current[date] !== version) return;
    setPlanByDate((current) => ({ ...current, [date]: saved }));
  } catch {
    if (mutationVersionByDate.current[date] !== version) return;
    setPlanByDate((current) => ({ ...current, [date]: previous }));
    setMutationError(t("planner.saveFailed"));
  }
}
```

Render the error as a dismissible, non-blocking `role="status"` above the board. Add matching English and Chinese `planner.saveFailed` and `planner.dismissError` messages.

- [ ] **Step 4: Run focused and full web tests**

Run: `npm --workspace @cooking/web test -- app/planner/page.test.tsx app/planner/plannerModel.test.ts app/planner/components/PlannerMealSlot.test.tsx app/planner/components/PlannerWeekBoard.test.tsx`

Run: `npm run test:web`

Expected: focused planner tests and full web suite PASS.

- [ ] **Step 5: Commit integrated behavior**

```bash
git add apps/web/app/planner/page.tsx apps/web/app/planner/page.test.tsx packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(planner): integrate compact reliable week board"
```

---

### Task 5: Enforce viewport layout and browser acceptance

**Files:**
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/e2e/planner.spec.ts`
- Create: `apps/web/e2e/__screenshots__/planner.spec.ts/planner-desktop-darwin.png`
- Create: `apps/web/e2e/__screenshots__/planner.spec.ts/planner-desktop-linux.png`

**Interfaces:**
- Consumes: planner semantic class names from Tasks 2–4.
- Produces: fixed-height desktop app surface, internal recipe-rail scroll, compact grid, responsive fallback, and deterministic 1280×800 browser coverage.

- [ ] **Step 1: Write the failing 1280×800 Playwright test**

Create fixture routes for `/auth/me`, `/recipes`, `/meal-plan?*`, and meal-plan PUT. Use at least 24 saved recipes and fixture slots containing zero, one, two, and three recipes. Set `test.use({ viewport: { width: 1280, height: 800 } })`.

Assert:

```ts
await expect(page.getByTestId("planner-day-column")).toHaveCount(7);
await expect(page.getByTestId("planner-meal-slot")).toHaveCount(21);
expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
expect(await page.locator(".planner-editorial__sidebar-scroll").evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
await expect(page.getByRole("button", { name: /Show 1 more recipe/ })).toBeVisible();
```

Also exercise click-to-add, remove, open, overflow Escape focus restoration, and one synthetic drag/drop using `new DataTransfer()`.

- [ ] **Step 2: Run the focused browser test to verify RED**

Run: `PORT=3100 npm --workspace @cooking/web run test:e2e -- planner.spec.ts`

Expected: FAIL on the no-document-scroll assertion with the current large meal cards.

- [ ] **Step 3: Implement the desktop and responsive CSS contract**

Add `--app-header-height: 72px` to `:root`. At `min-width: 1024px`, set the planner surface to `height: calc(100dvh - var(--app-header-height))`, `overflow: hidden`, and a constrained rail width of `clamp(15.5rem, 18vw, 18rem)`. Give the main column and grid `min-height: 0`; make the board consume remaining height; define each day as a compact header plus three `minmax(0, 1fr)` meal rows.

Compact tiles are horizontal with a small fixed thumbnail, flexible two-line title, focus-visible remove control, and no card-sized minimum height. At `max-width: 1023px`, restore `height: auto`, document scrolling, the existing mobile guide, stacked day flow, and picker sheet.

```css
:root {
  --app-header-height: 72px;
}

@media (min-width: 1024px) {
  .planner-editorial {
    height: calc(100dvh - var(--app-header-height));
    overflow: hidden;
    grid-template-columns: clamp(15.5rem, 18vw, 18rem) minmax(0, 1fr);
  }

  .planner-editorial__main,
  .planner-editorial__grid,
  .planner-editorial__day-column,
  .planner-editorial__day-body {
    min-height: 0;
  }

  .planner-editorial__main {
    overflow: hidden;
  }

  .planner-editorial__grid {
    flex: 1;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .planner-editorial__day-body {
    display: grid;
    grid-template-rows: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1023px) {
  .planner-editorial {
    height: auto;
    overflow: visible;
  }
}
```

- [ ] **Step 4: Generate and inspect the Darwin baseline**

Run: `PORT=3100 npm --workspace @cooking/web run test:e2e:update -- planner.spec.ts`

Inspect the full-resolution Darwin PNG with the image viewer. Confirm all seven columns, every meal label, compact tiles, overflow control, rail footer, and week navigation are visible without clipping.

- [ ] **Step 5: Generate the Linux baseline through the pinned Playwright container**

Run:

```bash
docker run --rm --platform linux/amd64 --network host -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.58.0-noble bash -lc 'PORT=3100 npm --workspace @cooking/web run test:e2e:update -- planner.spec.ts'
```

Inspect the Linux PNG and then run normal comparison on both the host and container.

- [ ] **Step 6: Run the complete planner gate**

Run: `npm run test:web`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npm run web:build`

Run: `PORT=3100 npm --workspace @cooking/web run test:e2e -- planner.spec.ts e2e/shell.spec.ts`

Run: `git diff --check`

Expected: all commands exit 0; planner and authenticated-shell comparisons pass.

- [ ] **Step 7: Commit the viewport acceptance gate**

```bash
git add apps/web/app/globals.css apps/web/e2e/planner.spec.ts apps/web/e2e/__screenshots__/planner.spec.ts
git commit -m "test(planner): gate the desktop viewport"
```
