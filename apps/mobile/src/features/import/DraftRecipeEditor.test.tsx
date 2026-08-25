import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { Recipe } from "@cooking/shared";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

const mockApiClient = { recipes: { uploadImage: jest.fn() } };

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
}));

const draft: Recipe = {
  id: "draft",
  title: "Tomato egg stir-fry",
  thumbnail_url: null,
  ingredients: [{ name: "Tomato", quantity: "2", notes: "ripe" }],
  steps: [{ text: "Cook until glossy." }],
};

test("keeps import review focused on editable recipe content", async () => {
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

  expect(screen.queryByRole("button", { name: "Add cover image" })).not.toBeOnTheScreen();
  expect(screen.queryByText("Or paste an image URL")).not.toBeOnTheScreen();
  expect(screen.queryByText("Add image")).not.toBeOnTheScreen();
  expect(screen.queryByLabelText("Ingredient notes")).not.toBeOnTheScreen();
});
