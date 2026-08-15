import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
