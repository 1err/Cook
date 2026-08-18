import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Recipe } from "@cooking/shared";
import { I18nProvider } from "../../lib/i18n";
import { PlannerMealSlot } from "./PlannerMealSlot";

const recipes: Record<string, Recipe> = Object.fromEntries(
  ["One", "Two", "Three", "Four", "Five"].map((title, index) => [
    `r${index + 1}`,
    { id: `r${index + 1}`, title, ingredients: [] },
  ]),
);

const storedValues = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    clear: () => storedValues.clear(),
    getItem: (key: string) => storedValues.get(key) ?? null,
    removeItem: (key: string) => storedValues.delete(key),
    setItem: (key: string, value: string) => storedValues.set(key, value),
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderSlot(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

function slotProps() {
  return {
    date: "2026-08-10",
    slot: "dinner" as const,
    recipeIds: ["r1", "r2", "r3"],
    recipesById: recipes,
    isDragOver: false,
    onChoose: vi.fn(),
    onOpen: vi.fn(),
    onRemove: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
  };
}

test("renders three compact recipes directly without an overflow trigger or dialog", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  expect(screen.getByRole("button", { name: "Open One for dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Two for dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Three for dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove One from dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add another recipe for dinner on 2026-08-10" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Show .* more recipe/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("keeps a fourth recipe in a keyboard-reachable in-slot scroll region", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} recipeIds={["r1", "r2", "r3", "r4"]} />);

  const recipeList = screen.getByRole("region", {
    name: "Dinner recipes for 2026-08-10",
  });
  expect(recipeList).toHaveAttribute("tabindex", "0");
  expect(
    within(recipeList).getByRole("button", {
      name: "Open Four for dinner on 2026-08-10",
    }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Show .* more recipe/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("shows a visible singular overflow cue that describes the scrollable recipe region", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} recipeIds={["r1", "r2", "r3", "r4"]} />);

  expect(screen.getByText("Scroll for 1 more")).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Dinner recipes for 2026-08-10" }),
  ).toHaveAccessibleDescription("Scroll for 1 more");
});

test("updates and removes the overflow cue as parent recipe data changes", () => {
  const props = { ...slotProps(), recipeIds: ["r1", "r2", "r3", "r4", "r5"] };
  const view = renderSlot(<PlannerMealSlot {...props} />);

  expect(screen.getByText("Scroll for 2 more")).toBeVisible();

  view.rerender(
    <I18nProvider>
      <PlannerMealSlot {...props} recipeIds={["r1", "r2", "r3", "r4"]} />
    </I18nProvider>,
  );
  expect(screen.getByText("Scroll for 1 more")).toBeVisible();

  view.rerender(
    <I18nProvider>
      <PlannerMealSlot {...props} recipeIds={["r1", "r2", "r3"]} />
    </I18nProvider>,
  );
  expect(screen.queryByText(/Scroll for \d+ more/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Dinner recipes for 2026-08-10" }),
  ).not.toHaveAccessibleDescription();
});

test("forwards visible recipe, add, and drag callbacks", async () => {
  const user = userEvent.setup();
  const props = slotProps();
  renderSlot(<PlannerMealSlot {...props} />);

  await user.click(screen.getByRole("button", { name: "Open One for dinner on 2026-08-10" }));
  await user.click(screen.getByRole("button", { name: "Remove One from dinner on 2026-08-10" }));
  await user.click(screen.getByRole("button", { name: "Add another recipe for dinner on 2026-08-10" }));
  const root = screen.getByTestId("planner-meal-slot");
  fireEvent.dragOver(root);
  fireEvent.dragLeave(root);
  fireEvent.drop(root);

  expect(props.onOpen).toHaveBeenCalledWith("r1");
  expect(props.onRemove).toHaveBeenCalledWith("r1");
  expect(props.onChoose).toHaveBeenCalledTimes(1);
  expect(props.onDragOver).toHaveBeenCalledTimes(1);
  expect(props.onDragLeave).toHaveBeenCalledTimes(1);
  expect(props.onDrop).toHaveBeenCalledTimes(1);
});

test("rehomes focus to the previous remove control after the third of three recipes is removed", async () => {
  const user = userEvent.setup();
  const props = slotProps();
  const view = renderSlot(<PlannerMealSlot {...props} />);

  const removeThree = screen.getByRole("button", {
    name: "Remove Three from dinner on 2026-08-10",
  });
  await user.click(removeThree);
  expect(removeThree).toHaveFocus();

  view.rerender(
    <I18nProvider>
      <PlannerMealSlot {...props} recipeIds={["r1", "r2"]} />
    </I18nProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Remove Two from dinner on 2026-08-10",
      }),
    ).toHaveFocus(),
  );
});

test("rehomes focus to the next remove control after an asynchronous parent removes the third of four recipes", async () => {
  const user = userEvent.setup();
  const props = { ...slotProps(), recipeIds: ["r1", "r2", "r3", "r4"] };
  const view = renderSlot(<PlannerMealSlot {...props} />);

  const removeThree = screen.getByRole("button", {
    name: "Remove Three from dinner on 2026-08-10",
  });
  await user.click(removeThree);
  expect(removeThree).toHaveFocus();

  view.rerender(
    <I18nProvider>
      <PlannerMealSlot {...props} recipeIds={["r1", "r2", "r4"]} />
    </I18nProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Remove Four from dinner on 2026-08-10",
      }),
    ).toHaveFocus(),
  );
});

test("uses a date-and-meal-specific accessible name for the empty add control", async () => {
  const user = userEvent.setup();
  const props = { ...slotProps(), recipeIds: [] };
  renderSlot(<PlannerMealSlot {...props} />);

  await user.click(screen.getByRole("button", { name: "Choose a recipe for dinner on 2026-08-10" }));
  expect(props.onChoose).toHaveBeenCalledTimes(1);
});

test("localizes visible meal text and contextual controls in Chinese", async () => {
  localStorage.setItem("cooking-ui-language", "zh");
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  expect(await screen.findByText("晚餐")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "打开 2026-08-10 晚餐的 One" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "打开 2026-08-10 晚餐的 Three" }),
  ).toBeVisible();
});

test("localizes the recipe overflow cue in Chinese", async () => {
  localStorage.setItem("cooking-ui-language", "zh");
  renderSlot(<PlannerMealSlot {...slotProps()} recipeIds={["r1", "r2", "r3", "r4"]} />);

  expect(await screen.findByText("滚动查看另外 1 道菜谱")).toBeVisible();
  expect(
    screen.getByRole("region", { name: "2026-08-10 的晚餐菜谱" }),
  ).toHaveAccessibleDescription("滚动查看另外 1 道菜谱");
});
