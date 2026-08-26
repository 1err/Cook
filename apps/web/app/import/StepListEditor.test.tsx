import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecipeStep } from "@cooking/shared";
import { StepListEditor } from "./StepListEditor";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "recipe.steps": "Steps",
      "recipe.steps.empty": "No steps",
      "recipe.step.addRow": "Add step",
      "recipe.step.textPlaceholder": "Step instructions",
      "recipe.tutorial.editor.duration": "Duration",
      "recipe.tutorial.editor.attention": "Attention",
      "recipe.tutorial.editor.illustration": "Illustration",
      "recipe.tutorial.editor.stepLabel": "Step {step}",
      "recipe.tutorial.editor.durationLabel": "Step {step} duration",
      "recipe.tutorial.editor.durationMinutes": "Step {step} minutes",
      "recipe.tutorial.editor.durationSeconds": "Step {step} seconds",
      "recipe.tutorial.editor.durationInvalid": "Enter a duration from 1 second to 24 hours.",
      "recipe.tutorial.editor.illustrationLabel": "Step {step} illustration",
      "recipe.tutorial.editor.moveUp": "Move step {step} up",
      "recipe.tutorial.editor.moveDown": "Move step {step} down",
      "recipe.tutorial.editor.remove": "Remove step {step}",
      "recipe.tutorial.source.stated": "From recipe",
      "recipe.tutorial.source.estimated": "AI estimated",
      "recipe.tutorial.source.user": "Adjusted",
      "recipe.tutorial.source.fallback": "Rough estimate",
      "recipe.tutorial.attention.handsOn": "Hands-on",
      "recipe.tutorial.attention.passive": "Passive",
      "recipe.tutorial.action.prep": "Prep",
      "recipe.tutorial.action.chop": "Chop",
      "recipe.tutorial.action.mix": "Mix",
      "recipe.tutorial.action.season": "Season",
      "recipe.tutorial.action.sear": "Sear",
      "recipe.tutorial.action.simmer": "Simmer",
      "recipe.tutorial.action.boil": "Boil",
      "recipe.tutorial.action.bake": "Bake",
      "recipe.tutorial.action.rest": "Rest",
      "recipe.tutorial.action.drain": "Drain",
      "recipe.tutorial.action.assemble": "Assemble",
      "recipe.tutorial.action.plate": "Plate",
      "recipe.tutorial.action.other": "Other",
    };
    return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
  },
}));

const estimatedStep: RecipeStep = {
  id: "d042d265-8ac1-46cf-9d26-0c459538b8bb",
  text: "Simmer until glossy.",
  duration_seconds: 480,
  duration_source: "estimated",
  attention_type: "hands_on",
  action_type: "simmer",
  image_url: "https://example.com/hidden-step.jpg",
};

function EditorHarness({
  initialSteps,
  onChange = () => undefined,
  onValidityChange,
  disabled = false,
}: {
  initialSteps: RecipeStep[];
  onChange?: (steps: RecipeStep[]) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
}) {
  const [steps, setSteps] = useState(initialSteps);
  return (
    <StepListEditor
      steps={steps}
      onChange={(next) => {
        setSteps(next);
        onChange(next);
      }}
      onValidityChange={onValidityChange}
      disabled={disabled}
    />
  );
}

afterEach(cleanup);

describe("StepListEditor", () => {
  it("disables every draft mutation while a parent request is pending", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(steps: RecipeStep[]) => void>();
    render(
      <EditorHarness
        disabled
        initialSteps={[estimatedStep]}
        onChange={onChange}
      />,
    );

    const instructions = screen.getByRole("textbox", { name: "Step 1" });
    expect(instructions).toBeDisabled();
    expect(screen.getByLabelText("Step 1 minutes")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Passive" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Step 1 illustration" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove step 1" })).toBeDisabled();

    await user.type(instructions, " should not change");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    expect(instructions).toHaveValue(estimatedStep.text);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks an edited estimate as user-authored without dropping hidden step data", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(steps: RecipeStep[]) => void>();
    render(<EditorHarness initialSteps={[estimatedStep]} onChange={onChange} />);

    expect(screen.getByText("AI estimated")).toBeVisible();
    expect(screen.queryByRole("button", { name: /image/i })).not.toBeInTheDocument();

    const minutes = screen.getByLabelText("Step 1 minutes");
    await user.clear(minutes);
    await user.type(minutes, "3");

    expect(onChange.mock.calls.at(-1)?.[0][0]).toEqual({
      ...estimatedStep,
      duration_seconds: 180,
      duration_source: "user",
    });
    expect(screen.getByText("Adjusted")).toBeVisible();
  });

  it("edits attention and every supported illustration option while preserving the step", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(steps: RecipeStep[]) => void>();
    render(<EditorHarness initialSteps={[estimatedStep]} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Hands-on" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Passive" })).toHaveAttribute("aria-pressed", "false");

    const illustration = screen.getByRole("combobox", { name: "Step 1 illustration" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Prep",
      "Chop",
      "Mix",
      "Season",
      "Sear",
      "Simmer",
      "Boil",
      "Bake",
      "Rest",
      "Drain",
      "Assemble",
      "Plate",
      "Other",
    ]);

    await user.click(screen.getByRole("button", { name: "Passive" }));
    await user.selectOptions(illustration, "bake");

    expect(onChange.mock.calls.at(-1)?.[0][0]).toEqual({
      ...estimatedStep,
      attention_type: "passive",
      action_type: "bake",
    });
  });

  it("adds canonical rows and keeps IDs stable through reorder and removal", async () => {
    const user = userEvent.setup();
    const secondStep: RecipeStep = {
      ...estimatedStep,
      id: "063fd784-ff21-4716-a323-f19b00315847",
      text: "Plate and serve.",
      image_url: null,
    };
    const onChange = vi.fn<(steps: RecipeStep[]) => void>();
    render(<EditorHarness initialSteps={[estimatedStep, secondStep]} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Move step 1 down" }));
    expect(onChange.mock.calls.at(-1)?.[0].map((step) => step.id)).toEqual([
      secondStep.id,
      estimatedStep.id,
    ]);

    await user.click(screen.getByRole("button", { name: "Add step" }));
    const afterAdd = onChange.mock.calls.at(-1)?.[0] ?? [];
    expect(afterAdd).toHaveLength(3);
    expect(afterAdd[2]).toMatchObject({
      text: "",
      duration_seconds: 300,
      duration_source: "fallback",
      attention_type: "hands_on",
      action_type: "other",
    });
    expect(afterAdd[2].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    await user.click(screen.getByRole("button", { name: "Remove step 2" }));
    expect(onChange.mock.calls.at(-1)?.[0].map((step) => step.id)).toEqual([
      secondStep.id,
      afterAdd[2].id,
    ]);
  });

  it("keeps a cleared duration locally invalid and accepts a one-second user duration", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(steps: RecipeStep[]) => void>();
    const onValidityChange = vi.fn<(valid: boolean) => void>();
    render(
      <EditorHarness
        initialSteps={[{ ...estimatedStep, duration_seconds: 60 }]}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />,
    );

    const minutes = screen.getByLabelText("Step 1 minutes");
    const seconds = screen.getByLabelText("Step 1 seconds");
    await user.clear(minutes);

    expect(minutes).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a duration from 1 second to 24 hours.")).toBeVisible();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    await user.type(minutes, "0");
    await user.clear(seconds);
    await user.type(seconds, "1");

    expect(onChange.mock.calls.at(-1)?.[0][0]).toMatchObject({
      id: estimatedStep.id,
      duration_seconds: 1,
      duration_source: "user",
      image_url: estimatedStep.image_url,
    });
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("clamps user duration edits to 24 hours", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(steps: RecipeStep[]) => void>();
    render(<EditorHarness initialSteps={[estimatedStep]} onChange={onChange} />);

    const minutes = screen.getByLabelText("Step 1 minutes");
    await user.clear(minutes);
    await user.type(minutes, "2000");

    expect(onChange.mock.calls.at(-1)?.[0][0]).toMatchObject({
      id: estimatedStep.id,
      duration_seconds: 86_400,
      duration_source: "user",
      image_url: estimatedStep.image_url,
    });
    expect(minutes).toHaveValue(1_440);
  });
});
