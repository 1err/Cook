import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Button } from "./Button";

test("announces loading and prevents duplicate activation", async () => {
  const onClick = vi.fn();

  render(
    <Button loading onClick={onClick}>
      Save recipe
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Save recipe" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");

  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});
