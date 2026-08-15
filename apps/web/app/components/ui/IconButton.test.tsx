import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { IconButton } from "./IconButton";

test("requires a readable accessible name", () => {
  render(<IconButton icon="add" label="Add recipe" onClick={() => undefined} />);

  expect(screen.getByRole("button", { name: "Add recipe" })).toBeVisible();
});
