import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECIPE_ACTION_MESSAGE_KEYS,
  RECIPE_ACTION_TYPES,
  type RecipeActionType,
} from "@cooking/shared";
import { RecipeStepIllustration } from "./RecipeStepIllustration";

const actionLabels: Record<RecipeActionType, string> = {
  prep: "Prep",
  chop: "Chop",
  mix: "Mix",
  season: "Season",
  sear: "Sear",
  simmer: "Simmer",
  boil: "Boil",
  bake: "Bake",
  rest: "Rest",
  drain: "Drain",
  assemble: "Assemble",
  plate: "Plate",
  other: "Other",
};

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    if (key === "recipe.tutorial.illustrationLabel") {
      return `${vars?.action ?? ""} illustration`;
    }
    return key;
  },
}));

afterEach(cleanup);

describe("RecipeStepIllustration", () => {
  it.each(RECIPE_ACTION_TYPES)("renders the %s action as an accessible vector without emoji", (actionType) => {
    const { container } = render(
      <RecipeStepIllustration actionType={actionType} title={actionLabels[actionType]} />,
    );

    const illustration = screen.getByRole("img", {
      name: `${actionLabels[actionType]} illustration`,
    });
    expect(illustration.tagName).toBe("svg");
    expect(illustration.querySelector("path, circle, line")).not.toBeNull();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(RECIPE_ACTION_MESSAGE_KEYS[actionType]).toMatch(/^recipe\.tutorial\.action\./);
  });
});
