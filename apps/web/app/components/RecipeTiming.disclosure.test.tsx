import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { RecipeCard } from "./RecipeCard";

vi.mock("next/navigation", () => ({ usePathname: () => "/library" }));
const recipe = { id: "slow", title: "Braised beef", total_time_minutes: 500,
  timing_summary: { hands_on_minutes: 20, passive_minutes: 480, is_estimate: false } };
beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => "en", setItem: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show() { return render(<I18nProvider><RecipeCard recipe={recipe} /></I18nProvider>); }

describe("library timing disclosure", () => {
  it("keeps only the total visible until hovered, outside the navigation link", async () => {
    const user = userEvent.setup();
    show();
    const button = screen.getByRole("button", { name: "Timing details: 8 hr 20 min" });
    expect(button).toHaveTextContent("8 hr 20 min");
    expect(button.closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: recipe.title })).toHaveAttribute("href", "/recipe/slow");
    expect(screen.queryByText("20 min hands-on")).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.hover(button);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("20 min hands-on")).toBeVisible();
    expect(within(tooltip).getByText("8 hr passive")).toBeVisible();
    expect(tooltip.closest("article")).toBeNull();
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("opens on keyboard focus, dismisses with Escape, and can be opened again", async () => {
    const user = userEvent.setup();
    show();
    await user.tab();
    expect(screen.getByRole("link")).toHaveFocus();
    await user.tab();
    const button = screen.getByRole("button");
    expect(button).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps the first touch open, toggles on another tap, and dismisses outside", async () => {
    const user = userEvent.setup();
    show();
    const button = screen.getByRole("button");
    await user.pointer([{ keys: "[TouchA>]", target: button }, { keys: "[/TouchA]" }]);
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.pointer([{ keys: "[TouchA>]", target: button }, { keys: "[/TouchA]" }]);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.pointer([{ keys: "[TouchA>]", target: button }, { keys: "[/TouchA]" }]);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("allows the pointer to reach and remain over the tooltip", async () => {
    const user = userEvent.setup();
    show();
    const button = screen.getByRole("button");
    await user.hover(button);
    const tooltip = screen.getByRole("tooltip");
    await user.hover(tooltip);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(tooltip).toBeVisible();
    await user.unhover(tooltip);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("dismisses on tab-away after Escape removed a hovered tooltip", async () => {
    const user = userEvent.setup();
    show();
    const button = screen.getByRole("button");
    await user.hover(button);
    await user.hover(screen.getByRole("tooltip"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.hover(document.body);
    await user.tab();
    expect(screen.getByRole("link")).toHaveFocus();
    await user.tab();
    expect(button).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
