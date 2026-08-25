import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./Button";

test("announces loading and blocks duplicate presses", async () => {
  const onPress = jest.fn();
  await render(<Button title="Save recipe" loading onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Save recipe" });
  expect(screen.getByText("Save recipe")).toBeTruthy();
  expect(button).toBeBusy();
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});

test("uses a stable, non-pill control shape", async () => {
  await render(<Button title="Save" onPress={jest.fn()} />);

  expect(screen.getByRole("button", { name: "Save" })).toHaveStyle({
    minHeight: 44,
    borderRadius: 12,
  });
});
