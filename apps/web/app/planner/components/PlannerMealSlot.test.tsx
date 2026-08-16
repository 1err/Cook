import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Recipe } from "@cooking/shared";
import { I18nProvider } from "../../lib/i18n";
import { PlannerMealSlot } from "./PlannerMealSlot";

const recipes: Record<string, Recipe> = Object.fromEntries(
  ["One", "Two", "Three"].map((title, index) => [
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

test("renders two compact recipes and an accessible overflow count", () => {
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  expect(screen.getByRole("button", { name: "Open One for dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Two for dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove One from dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add another recipe for dinner on 2026-08-10" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open Three for dinner on 2026-08-10" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show 1 more recipe for dinner on 2026-08-10" })).toBeVisible();
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

test("uses a date-and-meal-specific accessible name for the empty add control", async () => {
  const user = userEvent.setup();
  const props = { ...slotProps(), recipeIds: [] };
  renderSlot(<PlannerMealSlot {...props} />);

  await user.click(screen.getByRole("button", { name: "Choose a recipe for dinner on 2026-08-10" }));
  expect(props.onChoose).toHaveBeenCalledTimes(1);
});

test("closes overflow with Escape and restores focus", async () => {
  const user = userEvent.setup();
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  const trigger = screen.getByRole("button", { name: /Show 1 more recipe/ });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Dinner recipes for 2026-08-10" });
  expect(dialog).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Open Three for dinner on 2026-08-10" })).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Remove Three from dinner on 2026-08-10" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Close meal recipes" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("closes overflow with the Close button and restores focus", async () => {
  const user = userEvent.setup();
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  const trigger = screen.getByRole("button", { name: /Show 1 more recipe/ });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Close meal recipes" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("closes and rehomes focus when removing overflow removes its trigger", async () => {
  const user = userEvent.setup();

  function RemovingSlot() {
    const [recipeIds, setRecipeIds] = useState(["r1", "r2", "r3"]);
    return (
      <PlannerMealSlot
        {...slotProps()}
        recipeIds={recipeIds}
        onRemove={(recipeId) => setRecipeIds((current) => current.filter((id) => id !== recipeId))}
      />
    );
  }

  renderSlot(<RemovingSlot />);
  await user.click(screen.getByRole("button", { name: /Show 1 more recipe/ }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Remove Three from dinner on 2026-08-10",
    }),
  );

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(
    screen.getByRole("button", { name: "Add another recipe for dinner on 2026-08-10" }),
  ).toHaveFocus();
});

test("traps Tab and Shift+Tab inside the overflow dialog", async () => {
  const user = userEvent.setup();
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  await user.click(screen.getByRole("button", { name: /Show 1 more recipe/ }));
  const dialog = screen.getByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  expect(buttons[0]).toHaveFocus();
  await user.tab({ shift: true });
  expect(buttons.at(-1)).toHaveFocus();
  buttons.at(-1)?.focus();
  await user.tab();
  expect(buttons[0]).toHaveFocus();
});

test("localizes visible meal text, overflow count, and contextual controls in Chinese", async () => {
  localStorage.setItem("cooking-ui-language", "zh");
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  expect(await screen.findByText("晚餐")).toBeVisible();
  expect(screen.getByText("另有 1 道")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "打开 2026-08-10 晚餐的 One" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "显示 2026-08-10 晚餐的另外 1 道菜谱" }),
  ).toBeVisible();
});
