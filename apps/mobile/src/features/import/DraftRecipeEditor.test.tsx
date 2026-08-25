import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MESSAGE_MAP, type Recipe } from "@cooking/shared";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

const mockApiClient = { recipes: { uploadImage: jest.fn() } };

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

jest.mock("../../lib/i18n", () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) => {
    const { MESSAGE_MAP } = require("@cooking/shared") as typeof import("@cooking/shared");
    const template = MESSAGE_MAP.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables?.[name] ?? ""));
  },
}));

const draft: Recipe = {
  id: "draft",
  title: "Tomato egg stir-fry",
  thumbnail_url: null,
  ingredients: [{ name: "Tomato", quantity: "2", notes: "ripe" }],
  steps: [{
    id: "7c34a783-71dd-4741-8a68-6a3fdd077521",
    text: "Cook until glossy.",
    duration_seconds: 180,
    duration_source: "fallback",
    attention_type: "hands_on",
    action_type: "mix",
    image_url: "https://example.com/hidden.jpg",
  }],
};

test("keeps import review focused on editable recipe content without step image authoring", async () => {
  await render(
    <DraftRecipeEditor
      draft={draft}
      onChange={jest.fn()}
      saving={false}
      error={null}
      onSave={jest.fn()}
      allowImageEditing={false}
    />,
  );

  expect(screen.getByText("Title")).toBeOnTheScreen();
  expect(screen.getByText("Ingredients")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Add cover image" })).not.toBeOnTheScreen();
  expect(screen.queryByText("Or paste an image URL")).not.toBeOnTheScreen();
  expect(screen.queryByText("Add image")).not.toBeOnTheScreen();
  expect(screen.queryByText("Remove image")).not.toBeOnTheScreen();
  expect(screen.queryByLabelText("Ingredient notes")).not.toBeOnTheScreen();
});

test("keeps invalid duration input visible and disables import Save", async () => {
  await render(
    <DraftRecipeEditor
      draft={draft}
      onChange={jest.fn()}
      saving={false}
      error={null}
      onSave={jest.fn()}
      allowImageEditing={false}
    />,
  );

  await fireEvent.changeText(screen.getByLabelText("Step 1 minutes"), "");

  expect(screen.getByLabelText("Step 1 minutes")).toHaveProp("value", "");
  expect(screen.getByRole("button", { name: "Save recipe" })).toBeDisabled();
});

test("tutorial focus shows only tutorial controls and supports Estimate, Save, and Cancel", async () => {
  const onEstimate = jest.fn();
  const onCancel = jest.fn();
  await render(
    <DraftRecipeEditor
      draft={draft}
      focus="tutorial"
      onChange={jest.fn()}
      saving={false}
      estimating={false}
      canEstimate
      error={null}
      onEstimate={onEstimate}
      onSave={jest.fn()}
      onCancel={onCancel}
    />,
  );

  expect(screen.getByText("Edit tutorial")).toBeOnTheScreen();
  expect(screen.getByText(draft.title)).toBeOnTheScreen();
  expect(screen.queryByText("Title")).not.toBeOnTheScreen();
  expect(screen.queryByText("Ingredients")).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Estimate missing tutorial details" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(onEstimate).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("tutorial focus rejects draft mutations while Estimate is pending", async () => {
  const onChange = jest.fn();
  await render(
    <DraftRecipeEditor
      draft={draft}
      focus="tutorial"
      onChange={onChange}
      saving={false}
      estimating
      canEstimate
      error={null}
      onEstimate={jest.fn()}
      onSave={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Estimating tutorial details..." })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save tutorial" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add step" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Hands-on" })).toBeDisabled();

  await fireEvent.changeText(screen.getByLabelText("Step 1"), "Mutation that must be ignored");
  await fireEvent.press(screen.getByRole("button", { name: "Add step" }));
  expect(onChange).not.toHaveBeenCalled();
});
