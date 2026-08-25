import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { RecipeStep } from "@cooking/shared";
import { StepListEditor } from "./StepListEditor";

jest.mock("../../lib/i18n", () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) => {
    const { MESSAGE_MAP } = require("@cooking/shared") as typeof import("@cooking/shared");
    const template = MESSAGE_MAP.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables?.[name] ?? ""));
  },
}));

const estimatedStep: RecipeStep = {
  id: "85a0c55c-899e-468a-89ea-27c137686312",
  text: "Let the sauce simmer.",
  duration_seconds: 300,
  duration_source: "estimated",
  attention_type: "passive",
  action_type: "other",
  image_url: "https://example.com/hidden-step.jpg",
};

const secondStep: RecipeStep = {
  id: "2cff5f65-31aa-4d6b-903c-9195f5b3f78c",
  text: "Plate and serve.",
  duration_seconds: 60,
  duration_source: "stated",
  attention_type: "hands_on",
  action_type: "plate",
  image_url: "https://example.com/hidden-plate.jpg",
};

function latestSteps(onChange: jest.Mock): RecipeStep[] {
  return onChange.mock.calls.at(-1)?.[0] as RecipeStep[];
}

test("shows transparent metadata and marks a valid duration edit as user adjusted", async () => {
  const onChange = jest.fn();
  await render(<StepListEditor steps={[estimatedStep]} onChange={onChange} />);

  expect(screen.getByText("About 5 min · AI estimated · Passive")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Passive" })).toBeSelected();

  await fireEvent.changeText(screen.getByLabelText("Step 1 minutes"), "3");

  expect(latestSteps(onChange)[0]).toEqual({
    ...estimatedStep,
    duration_seconds: 180,
    duration_source: "user",
  });
});

test("retains an invalid duration locally and reports invalidity without changing the draft", async () => {
  const onChange = jest.fn();
  const onValidityChange = jest.fn();
  await render(
    <StepListEditor
      steps={[estimatedStep]}
      onChange={onChange}
      onValidityChange={onValidityChange}
    />,
  );

  const minutes = screen.getByLabelText("Step 1 minutes");
  await fireEvent.changeText(minutes, "");

  expect(minutes).toHaveProp("value", "");
  expect(screen.getByText("Enter a duration from 1 second to 24 hours.")).toBeOnTheScreen();
  expect(onChange).not.toHaveBeenCalled();
  expect(onValidityChange).toHaveBeenLastCalledWith(false);
});

test("edits attention and chooses from all illustration options in an accessible modal", async () => {
  const onChange = jest.fn();
  await render(<StepListEditor steps={[estimatedStep]} onChange={onChange} />);

  await fireEvent.press(screen.getByRole("button", { name: "Hands-on" }));
  expect(latestSteps(onChange)[0]).toEqual({ ...estimatedStep, attention_type: "hands_on" });

  await fireEvent.press(screen.getByRole("button", { name: "Step 1 illustration" }));
  const picker = screen.getByLabelText("Step 1 illustration options");
  expect(within(picker).getAllByRole("radio")).toHaveLength(13);
  await fireEvent.press(within(picker).getByRole("radio", { name: "Simmer" }));

  expect(latestSteps(onChange)[0]).toEqual({ ...estimatedStep, action_type: "simmer" });
});

test("adds canonical unique steps and preserves IDs and hidden images when reordering", async () => {
  const onChange = jest.fn();
  const { rerender } = await render(
    <StepListEditor steps={[estimatedStep, secondStep]} onChange={onChange} />,
  );

  await fireEvent.press(screen.getByRole("button", { name: "Add step" }));
  const added = latestSteps(onChange)[2];
  expect(added).toMatchObject({
    text: "",
    duration_seconds: 300,
    duration_source: "fallback",
    attention_type: "hands_on",
    action_type: "other",
  });
  expect(added.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(added.id).not.toBe(estimatedStep.id);
  expect(added.id).not.toBe(secondStep.id);

  onChange.mockClear();
  await rerender(<StepListEditor steps={[estimatedStep, secondStep]} onChange={onChange} />);
  await fireEvent.press(screen.getByRole("button", { name: "Move step 1 down" }));
  expect(latestSteps(onChange)).toEqual([secondStep, estimatedStep]);
  expect(screen.queryByText("Add image")).not.toBeOnTheScreen();
  expect(screen.queryByText("Remove image")).not.toBeOnTheScreen();
});

test("keeps every editor action at least 44 points", async () => {
  await render(<StepListEditor steps={[estimatedStep]} onChange={jest.fn()} />);

  for (const name of [
    "Add step",
    "Hands-on",
    "Passive",
    "Step 1 illustration",
    "Move step 1 up",
    "Move step 1 down",
    "Remove step 1",
  ]) {
    expect(screen.getByRole("button", { name })).toHaveStyle({ minHeight: 44, minWidth: 44 });
  }
  for (const field of [
    screen.getByLabelText("Step 1 minutes"),
    screen.getByLabelText("Step 1 seconds"),
  ]) {
    const style = StyleSheet.flatten(field.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  }
});
