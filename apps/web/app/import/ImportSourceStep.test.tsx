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

    expect(screen.getByRole("tab", { name: "Video link" })).toHaveAttribute("aria-selected", "true");
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

  it("explains the public-text fallback for YouTube imports", () => {
    render(
      <ImportSourceStep
        values={values}
        parsing={false}
        error={null}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "YouTube imports use public captions, then the video description if captions are unavailable. TikTok imports use the public caption and title.",
      ),
    ).toBeVisible();
  });

  it("accepts YouTube or TikTok links and locks every source control while parsing", async () => {
    const user = userEvent.setup();
    render(
      <ImportSourceStep
        values={{ ...values, url: "https://vm.tiktok.com/ZMrecipe/" }}
        parsing
        error="retry"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Video link" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Paste recipe text" })).toBeDisabled();
    expect(screen.getByLabelText("YouTube or TikTok URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Optional details" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Optional details" }));
    expect(screen.queryByLabelText("Title (optional)")).not.toBeInTheDocument();
  });

  it("locks transcript and expanded optional controls while parsing", async () => {
    const user = userEvent.setup();
    const transcriptValues: ImportSourceValues = {
      ...values,
      mode: "transcript",
      transcript: "Boil noodles, then toss with sauce.",
    };
    const { rerender } = render(
      <ImportSourceStep
        values={transcriptValues}
        parsing={false}
        error={null}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Optional details" }));

    rerender(
      <ImportSourceStep
        values={transcriptValues}
        parsing
        error={null}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Video link" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Paste recipe text" })).toBeDisabled();
    expect(screen.getByLabelText("Recipe text")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Optional details" })).toBeDisabled();
    expect(screen.getByLabelText("Title (optional)")).toBeDisabled();
    expect(screen.getByLabelText("Notes (optional)")).toBeDisabled();
    expect(screen.getByRole("group", { name: "Tags (optional)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quick" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Creating draft…" })).toBeDisabled();
  });

  it("emits a source edit so the page can clear a prior error", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ImportSourceStep
        values={values}
        parsing={false}
        error="old error"
        onChange={onChange}
        onSubmit={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/dQw4w9WgXcQ");
    expect(onChange).toHaveBeenCalled();
  });
});
