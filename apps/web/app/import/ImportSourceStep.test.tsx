import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportSourceStep, type ImportSourceValues } from "./ImportSourceStep";

const values: ImportSourceValues = {
  mode: "link",
  url: "",
  transcript: "",
  notes: "",
  title: "",
  libraryTags: [],
};

afterEach(cleanup);

describe("ImportSourceStep", () => {
  it("starts with a focused source choice and collapsed optional details", async () => {
    const user = userEvent.setup();
    render(
      <ImportSourceStep
        values={values}
        parsing={false}
        error={null}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "YouTube link" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByLabelText("Title (optional)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Optional details" }));
    expect(screen.getByLabelText("Title (optional)")).toBeVisible();
  });

  it("requires source content before creating a draft", () => {
    render(
      <ImportSourceStep
        values={values}
        parsing={false}
        error={null}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  });
});
