import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "../../types";
import { RecipeTutorial } from "./RecipeTutorial";

vi.mock("../../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "recipe.steps": "Steps",
      "recipe.tutorial.edit": "Edit tutorial",
      "recipe.tutorial.noSteps": "No tutorial steps yet. Add a step to get started.",
      "recipe.tutorial.duration.aboutMinutes": "About {minutes} min",
      "recipe.tutorial.source.estimated": "AI estimated",
      "recipe.tutorial.attention.passive": "Passive",
      "recipe.tutorial.action.simmer": "Simmer",
      "recipe.tutorial.action.chop": "Chop",
      "recipe.tutorial.illustrationLabel": "{action} illustration",
      "recipe.tutorial.stepImageAlt": "Step {step} image",
    };
    return (messages[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => String(vars?.[name] ?? ""),
    );
  },
}));

const recipe: Recipe = {
  id: "recipe-1",
  title: "Weeknight noodles",
  ingredients: [],
  steps: [
    {
      id: "4b70aa6d-af10-4b3b-8104-261cb8808fce",
      text: "Chop the scallions.",
      duration_seconds: 120,
      duration_source: "estimated",
      attention_type: "passive",
      action_type: "chop",
      image_url: "https://example.com/chop.jpg",
    },
    {
      id: "69310f63-572e-422c-a965-32b19cfb433d",
      text: "Simmer the sauce until glossy.",
      duration_seconds: 480,
      duration_source: "estimated",
      attention_type: "passive",
      action_type: "simmer",
      image_url: null,
    },
  ],
};

afterEach(cleanup);

describe("RecipeTutorial", () => {
  it("shows real step media first and transparent localized metadata", () => {
    render(<RecipeTutorial recipe={recipe} />);

    expect(screen.getByRole("heading", { name: "Steps" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit tutorial" })).toHaveAttribute(
      "href",
      "/recipe/recipe-1/tutorial/edit",
    );
    const firstStep = screen.getByText("Chop the scallions.").closest("li");
    expect(firstStep).not.toBeNull();
    expect(within(firstStep!).getByRole("img", { name: "Step 1 image" })).toHaveAttribute(
      "src",
      "https://example.com/chop.jpg",
    );
    expect(firstStep!.querySelector("svg")).toBeNull();
    expect(screen.getByText("About 8 min · AI estimated · Passive")).toBeVisible();
  });

  it("falls back to the action illustration when a real step image breaks", () => {
    render(<RecipeTutorial recipe={{ ...recipe, steps: [recipe.steps![0]] }} />);

    const image = screen.getByRole("img", { name: "Step 1 image" });
    fireEvent.error(image);

    expect(screen.queryByRole("img", { name: "Step 1 image" })).not.toBeInTheDocument();
    expect(screen.getByText("Chop the scallions.").closest("li")?.querySelector("svg")).not.toBeNull();
  });

  it("keeps the tutorial section actionable when there are no steps", () => {
    render(<RecipeTutorial recipe={{ ...recipe, steps: [] }} />);

    expect(screen.getByText("No tutorial steps yet. Add a step to get started.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit tutorial" })).toHaveAttribute(
      "href",
      "/recipe/recipe-1/tutorial/edit",
    );
  });
});
