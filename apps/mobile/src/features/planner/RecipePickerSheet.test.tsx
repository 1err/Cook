import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import type { Recipe } from "@cooking/shared";
import { RecipePickerSheet } from "./RecipePickerSheet";

jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  const { FlatList, View } = require("react-native");

  return {
    BottomSheetBackdrop: View,
    BottomSheetFlatList: FlatList,
    BottomSheetModal: React.forwardRef(
      ({ children }: { children: React.ReactNode }, ref: React.ForwardedRef<unknown>) => {
        React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
        return <View>{children}</View>;
      },
    ),
    BottomSheetView: View,
  };
});

const recipe: Recipe = {
  id: "recipe-1",
  title: "Tomato egg stir-fry",
  thumbnail_url: null,
  ingredients: [
    { name: "tomato", quantity: "2" },
    { name: "egg", quantity: "3" },
  ],
};

test("keeps picker controls and recipe results in one scroll surface", async () => {
  await render(
    <RecipePickerSheet recipes={[recipe]} onPick={jest.fn()} onImportRecipe={jest.fn()} />,
  );

  const content = screen.getByTestId("recipe-picker-content");
  expect(within(content).getByText("Add a recipe")).toBeOnTheScreen();
  expect(within(content).getByPlaceholderText("Search your library")).toBeOnTheScreen();
  expect(within(content).getByText("All")).toBeOnTheScreen();
  expect(within(content).getByText("Tomato egg stir-fry")).toBeOnTheScreen();
});
