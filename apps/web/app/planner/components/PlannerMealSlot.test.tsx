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
    onManage: vi.fn(),
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

test("marks one recipe with the one-row layout and exposes its complete title", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} recipeIds={["r1"]} />);

  expect(screen.getByRole("region")).toHaveAttribute("data-recipe-layout", "one");
  expect(screen.getByRole("button", { name: /Open One/ })).toHaveAttribute("title", "One");
});

test("marks two recipes with the two-row layout and exposes their complete titles", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} recipeIds={["r1", "r2"]} />);

  expect(screen.getByRole("region")).toHaveAttribute("data-recipe-layout", "two");
  expect(screen.getByRole("button", { name: /Open One/ })).toHaveAttribute("title", "One");
});

test("marks three recipes with the three-row layout and exposes their complete titles", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  expect(screen.getByRole("region")).toHaveAttribute("data-recipe-layout", "three");
  expect(screen.getByRole("button", { name: /Open One/ })).toHaveAttribute("title", "One");
});

test("marks four recipes with the overflow layout and exposes their complete titles", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} recipeIds={["r1", "r2", "r3", "r4"]} />);

  expect(screen.getByRole("region")).toHaveAttribute("data-recipe-layout", "overflow");
  expect(screen.getByRole("button", { name: /Open One/ })).toHaveAttribute("title", "One");
});

test("opens management for four or more recipes without stretching the meal cell", async () => {
  const user = userEvent.setup();
  const props = { ...slotProps(), recipeIds: ["r1", "r2", "r3", "r4"] };
  renderSlot(<PlannerMealSlot {...props} />);

  const recipeList = screen.getByRole("region", {
    name: "Dinner recipes for 2026-08-10",
  });
  expect(within(recipeList).getByRole("button", { name: "Open One for dinner on 2026-08-10" })).toBeVisible();
  expect(within(recipeList).getByRole("button", { name: "Open Two for dinner on 2026-08-10" })).toBeVisible();
  expect(within(recipeList).queryByRole("button", { name: "Open Four for dinner on 2026-08-10" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", {
    name: "View all 4 planned recipes for dinner on 2026-08-10",
  }));
  expect(props.onManage).toHaveBeenCalledTimes(1);
  expect(props.onChoose).not.toHaveBeenCalled();
});

test("shows a visible management cue for every recipe in the compact composition", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} recipeIds={["r1", "r2", "r3", "r4"]} />);

  expect(screen.getByText("View all 4")).toBeVisible();
});

test("updates and removes the management cue as parent recipe data changes", () => {
  const props = { ...slotProps(), recipeIds: ["r1", "r2", "r3", "r4", "r5"] };
  const view = renderSlot(<PlannerMealSlot {...props} />);

  expect(screen.getByText("View all 5")).toBeVisible();

  view.rerender(
    <I18nProvider>
      <PlannerMealSlot {...props} recipeIds={["r1", "r2", "r3", "r4"]} />
    </I18nProvider>,
  );
  expect(screen.getByText("View all 4")).toBeVisible();

  view.rerender(
    <I18nProvider>
      <PlannerMealSlot {...props} recipeIds={["r1", "r2", "r3"]} />
    </I18nProvider>,
  );
  expect(screen.queryByRole("button", { name: /View all .* planned recipes/ })).not.toBeInTheDocument();
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

test("rehomes focus to the next visible remove control as overflow collapses", async () => {
  const user = userEvent.setup();
  const props = { ...slotProps(), recipeIds: ["r1", "r2", "r3", "r4"] };
  const view = renderSlot(<PlannerMealSlot {...props} />);

  const removeTwo = screen.getByRole("button", {
    name: "Remove Two from dinner on 2026-08-10",
  });
  await user.click(removeTwo);
  expect(removeTwo).toHaveFocus();

  view.rerender(
    <I18nProvider>
      <PlannerMealSlot {...props} recipeIds={["r1", "r3", "r4"]} />
    </I18nProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Remove Three from dinner on 2026-08-10",
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

  expect(await screen.findByText("查看全部 4 道")).toBeVisible();
});
