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

  expect(screen.getByRole("button", { name: "Open One" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Two" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open Three" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show 1 more recipe for dinner on 2026-08-10" })).toBeVisible();
});

test("closes overflow with Escape and restores focus", async () => {
  const user = userEvent.setup();
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  const trigger = screen.getByRole("button", { name: /Show 1 more recipe/ });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "Dinner recipes for 2026-08-10" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("traps Tab inside the overflow dialog", async () => {
  const user = userEvent.setup();
  renderSlot(<PlannerMealSlot {...slotProps()} />);

  await user.click(screen.getByRole("button", { name: /Show 1 more recipe/ }));
  const dialog = screen.getByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  buttons.at(-1)?.focus();
  await user.tab();
  expect(buttons[0]).toHaveFocus();
});
