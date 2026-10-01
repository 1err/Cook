import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { CookingDish, CookingStep } from "@cooking/shared";
import { FocusedCookingStep } from "./FocusedCookingStep";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    if (key === "cook.step.number") return `Step ${vars?.current} of ${vars?.total}`;
    if (key === "cook.progress") return `${vars?.progress}% complete`;
    return key;
  },
}));

const now = "2026-09-22T12:00:00.000Z";

afterEach(cleanup);

function cookingStep(overrides: Partial<CookingStep>): CookingStep {
  return {
    id: "step-1",
    recipe_step_id: "recipe-step-1",
    position: 0,
    text: "Prepare the ingredients",
    duration_seconds: 120,
    duration_source: "stated",
    attention_type: "hands_on",
    action_type: "chop",
    image_url: null,
    state: "ready",
    timer_started_at: null,
    timer_ends_at: null,
    paused_remaining_seconds: null,
    resolved_at: null,
    notification_owner_device_id: null,
    revision: 1,
    updated_at: now,
    ...overrides,
  };
}

function cookingDish(steps: CookingStep[], thumbnailUrl = "https://images.example.test/recipe.jpg"): CookingDish {
  return {
    id: "dish-1",
    recipe_id: "recipe-1",
    position: 0,
    title: "Mapo tofu",
    thumbnail_url: thumbnailUrl,
    ingredients: [],
    equipment: [],
    tips: [],
    created_at: now,
    steps,
  };
}

function focusedImage(): HTMLImageElement | null {
  return screen.getByTestId("focused-step").querySelector("img");
}

test("tries the recipe thumbnail before the illustration when the step image fails", () => {
  render(
    <FocusedCookingStep
      dish={cookingDish([
        cookingStep({ image_url: "https://images.example.test/broken-step.jpg" }),
      ])}
      onAction={vi.fn()}
    />,
  );

  expect(focusedImage()?.getAttribute("src")).toBe("https://images.example.test/broken-step.jpg");
  fireEvent.error(focusedImage()!);
  expect(focusedImage()?.getAttribute("src")).toBe("https://images.example.test/recipe.jpg");

  fireEvent.error(focusedImage()!);
  expect(focusedImage()).toBeNull();
  expect(screen.getByTestId("focused-step").querySelector("svg")).not.toBeNull();
});

test("retries an image source when cooking advances to the next step", () => {
  const sharedStepImage = "https://images.example.test/shared-step.jpg";
  const firstStep = cookingStep({ image_url: sharedStepImage });
  const secondStep = cookingStep({
    id: "step-2",
    recipe_step_id: "recipe-step-2",
    position: 1,
    text: "Finish the dish",
    image_url: sharedStepImage,
  });
  const { rerender } = render(
    <FocusedCookingStep
      dish={cookingDish([firstStep, secondStep])}
      onAction={vi.fn()}
    />,
  );

  fireEvent.error(focusedImage()!);
  expect(focusedImage()?.getAttribute("src")).toBe("https://images.example.test/recipe.jpg");

  rerender(
    <FocusedCookingStep
      dish={cookingDish([
        { ...firstStep, state: "completed", resolved_at: now },
        secondStep,
      ])}
      onAction={vi.fn()}
    />,
  );

  expect(focusedImage()?.getAttribute("src")).toBe(sharedStepImage);
});

test("presents one compact progress treatment without repeating the step counter", () => {
  render(
    <FocusedCookingStep
      dish={cookingDish([
        cookingStep({ state: "completed", resolved_at: now }),
        cookingStep({
          id: "step-2",
          recipe_step_id: "recipe-step-2",
          position: 1,
          text: "Finish the dish",
        }),
      ])}
      onAction={vi.fn()}
    />,
  );

  const focus = within(screen.getByTestId("focused-step"));
  expect(focus.getByRole("heading", { name: "Finish the dish" })).toBeVisible();
  expect(focus.getAllByText("Step 2 of 2")).toHaveLength(1);
  expect(focus.getAllByText("50% complete")).toHaveLength(1);
});

for (const layout of ["focused", "stacked"] as const) {
  test(`unknown-duration passive steps allow finishing the dish without offering a timer in ${layout} view`, () => {
    const onAction = vi.fn();
    render(<FocusedCookingStep layout={layout} dish={cookingDish([cookingStep({ attention_type: "passive", duration_seconds: null, duration_source: "unknown" })])} onAction={onAction} />);
    expect(screen.queryByRole("button", { name: "cook.action.startTimer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "cook.navigation.finishDish" }));
    expect(onAction).toHaveBeenCalledWith("step-1", "complete");
    expect(screen.getByRole("button", { name: "cook.navigation.previous" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "cook.action.skip" })).not.toBeInTheDocument();
  });
}
