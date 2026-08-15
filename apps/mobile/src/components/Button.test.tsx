import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./Button";

test("announces loading and blocks duplicate presses", async () => {
  const onPress = jest.fn();
  await render(<Button title="Save recipe" loading onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Save recipe" });
  expect(button).toBeBusy();
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});
