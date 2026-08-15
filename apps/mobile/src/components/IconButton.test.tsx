import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { IconButton } from "./IconButton";

test("provides a named 44-point touch target", async () => {
  const onPress = jest.fn();
  await render(<IconButton icon="add" accessibilityLabel="Add recipe" onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Add recipe" });
  expect(button).toHaveStyle({ minWidth: 44, minHeight: 44 });
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("exposes disabled semantics", async () => {
  await render(
    <IconButton icon="trash" accessibilityLabel="Delete recipe" disabled onPress={jest.fn()} />,
  );

  expect(screen.getByRole("button", { name: "Delete recipe" })).toBeDisabled();
});
