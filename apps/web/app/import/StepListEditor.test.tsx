import { useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
      "recipe.step.uploadImage": "Add image",
      "recipe.step.imageUploadLabel": "Step {step} image",
      "recipe.step.imageUploadFailed": "Could not upload this step image. Try again.",
      "recipe.uploading": "Uploading…",
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
      "recipe.tutorial.evidence.moment": "Source",
      "recipe.tutorial.evidence.suggested": "Suggested step — review before cooking",
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
  uploadImage,
}: {
  initialSteps: RecipeStep[];
  onChange?: (steps: RecipeStep[]) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
  uploadImage?: (file: File) => Promise<string>;
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
      uploadImage={uploadImage}
    />
  );
}

afterEach(cleanup);

describe("step image uploads", () => {
  it.each([true, false])("preserves edits and reordering while targeting the original step (has ID: %s)", async (withId) => {
    let finish!: (url: string) => void;
    const uploadImage = vi.fn().mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    const secondStep = { ...estimatedStep, id: "second-step", text: "Serve the dish.", image_url: null };
    render(<EditorHarness initialSteps={[{ ...estimatedStep, id: withId ? estimatedStep.id : undefined, image_url: null }, secondStep]}
      uploadImage={uploadImage} onChange={onChange} onValidityChange={onValidityChange} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Step 1 image"), new File(["image"], "step.png", { type: "image/png" }));
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText("Step 1 image")).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Step 1" }), " Stir once.");
    await user.type(screen.getByRole("textbox", { name: "Step 2" }), " Add herbs.");
    await user.click(screen.getByRole("button", { name: "Move step 1 down" }));
    await act(async () => { finish("https://images.example/step.png"); });
    const saved = onChange.mock.calls.at(-1)![0];
    expect(saved.map((step: RecipeStep) => step.text)).toEqual(["Serve the dish. Add herbs.", "Simmer until glossy. Stir once."]);
    expect(saved[0]).toMatchObject({ id: secondStep.id, image_url: null });
    expect(saved[1]).toMatchObject({ image_url: "https://images.example/step.png", instruction_source: "user" });
    expect(saved[1].id).toBeTruthy();
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("shows upload failures and lets the same file be retried", async () => {
    const uploadImage = vi.fn().mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValueOnce("https://images.example/retry.png");
    const onChange = vi.fn();
    render(<EditorHarness initialSteps={[{ ...estimatedStep, image_url: null }]} uploadImage={uploadImage} onChange={onChange} />);
    const user = userEvent.setup();
    const file = new File(["image"], "step.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Step 1 image"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not upload this step image. Try again.");
    expect(screen.getByLabelText("Step 1 image")).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
    await user.upload(screen.getByLabelText("Step 1 image"), file);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({ ...estimatedStep, image_url: "https://images.example/retry.png" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["removed", "unmounted"])("ignores a late upload result after its step is %s", async (action) => {
    let finish!: (url: string) => void;
    const uploadImage = vi.fn().mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    const view = render(<EditorHarness initialSteps={[{ ...estimatedStep, image_url: null }]}
      uploadImage={uploadImage} onChange={onChange} onValidityChange={onValidityChange} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Step 1 image"), new File(["image"], "step.png", { type: "image/png" }));
    if (action === "removed") {
      await user.click(screen.getByRole("button", { name: "Remove step 1" }));
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
    }
    else view.unmount();
    onChange.mockClear();
    await act(async () => { finish("https://images.example/late.png"); });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("StepListEditor", () => {
  it("keeps source access and suggested-step reminders without authorship labels", () => {
    render(<StepListEditor
      sourceUrl="https://youtu.be/A6bByqI_TH8"
      steps={[
        { ...estimatedStep, instruction_source: "source", source_start_seconds: 12 },
        { ...estimatedStep, id: "user-step", instruction_source: "user" },
        { ...estimatedStep, id: "suggested-step", instruction_source: "suggested", source_start_seconds: 12 },
      ]}
      onChange={() => undefined}
    />);

    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=A6bByqI_TH8&t=12s");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("From source")).not.toBeInTheDocument();
    expect(screen.queryByText("Edited by you")).not.toBeInTheDocument();
    expect(screen.getByText("Suggested step — review before cooking")).toBeVisible();
    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move step 3 down" })).toBeDisabled();
  });

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
      duration_seconds: null,
      duration_source: "unknown",
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

it("allows missing duration and clears source evidence when instructions change", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(steps: RecipeStep[]) => void>();
  const onValidityChange = vi.fn();
  render(<EditorHarness initialSteps={[{ ...estimatedStep, instruction_source: "source", source_start_seconds: 5, source_excerpt: "Simmer" }]} onChange={onChange} onValidityChange={onValidityChange} />);
  await user.type(screen.getByRole("textbox", { name: "Step 1" }), " Then stir.");
  expect(onChange.mock.calls.at(-1)?.[0][0]).toMatchObject({ duration_seconds: null, duration_source: "unknown", instruction_source: "user", source_start_seconds: null, source_excerpt: null });
  expect(screen.getByLabelText("Step 1 minutes")).toHaveValue(null);
  expect(onValidityChange).toHaveBeenLastCalledWith(true);
});

it("allows both duration fields to be cleared without inventing a timer", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(steps: RecipeStep[]) => void>();
  const onValidityChange = vi.fn();
  render(<EditorHarness initialSteps={[estimatedStep]} onChange={onChange} onValidityChange={onValidityChange} />);
  await user.clear(screen.getByLabelText("Step 1 minutes"));
  await user.clear(screen.getByLabelText("Step 1 seconds"));
  expect(onChange.mock.calls.at(-1)?.[0][0]).toMatchObject({ duration_seconds: null, duration_source: "unknown" });
  expect(onValidityChange).toHaveBeenLastCalledWith(true);
});
