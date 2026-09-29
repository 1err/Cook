import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "../../types";
import { FriendLibraryCard } from "./FriendLibraryCard";

vi.mock("../../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string, vars?: Record<string, string | number>) =>
    (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? "")) };
});

const recipe: Recipe = {
  id: "friend-recipe",
  title: "Scallion noodles",
  thumbnail_url: null,
  total_time_minutes: 25,
  ingredients: [{ name: "Noodles", quantity: "200 g" }],
  library_tags: ["chinese", "weeknight", "main_dish"],
};

afterEach(cleanup);

describe("FriendLibraryCard", () => {
  it("shows the timing split without changing navigation or copying", () => {
    const onCopy = vi.fn();
    const slowRecipe = { ...recipe, total_time_minutes: 500, timing_summary: { hands_on_minutes: 20, passive_minutes: 480, is_estimate: false } };
    render(<FriendLibraryCard recipe={slowRecipe} href="/library/friends/one/friend-recipe" state="idle" onCopy={onCopy} />);
    expect(screen.queryByText("20 min hands-on")).not.toBeInTheDocument();
    const timing = screen.getByRole("button", { name: "Timing details: 8 hr 20 min" });
    expect(timing.closest("a")).toBeNull();
    fireEvent.focus(timing);
    expect(screen.getByText("20 min hands-on")).toBeVisible();
    expect(screen.getByText("8 hr passive")).toBeVisible();
    const link = screen.getByRole("link", { name: `Open ${recipe.title}` });
    expect(link).toHaveAttribute("href", "/library/friends/one/friend-recipe");
    expect(within(link).queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    expect(onCopy).toHaveBeenCalledOnce();
  });
  it("uses the same compact recipe metadata and an available copy action", () => {
    render(
      <FriendLibraryCard
        recipe={recipe}
        href="/library/friends/one/friend-recipe"
        state="idle"
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByText("25 min")).toBeVisible();
    expect(screen.queryByText("Noodles")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("friend-recipe-tag")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add to library" })).toBeEnabled();
  });

  it("communicates in-progress and completed copy states", () => {
    const { rerender } = render(
      <FriendLibraryCard recipe={recipe} href="#" state="copying" onCopy={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();

    rerender(<FriendLibraryCard recipe={recipe} href="#" state="added" onCopy={vi.fn()} />);
    expect(screen.getByRole("button", { name: "In your library" })).toBeDisabled();
  });
});
