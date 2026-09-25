import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportSourceStep, type ImportSourceValues } from "./ImportSourceStep";

vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return {
    useT: () => (key: string, vars?: Record<string, string | number>) =>
      (MESSAGE_MAP.en[key] || key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? "")),
  };
});

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

  it("explains public links, copied share text, and the upload fallback", () => {
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
        "Paste a public recipe link or copied share text. If the post cannot be opened, upload the video or paste its recipe text.",
      ),
    ).toBeVisible();
  });

  it("locks every source choice while parsing", async () => {
    const user = userEvent.setup();
    render(
      <ImportSourceStep
        values={{ ...values, url: "https://vm.tiktok.com/ZMrecipe/" }}
        mediaEnabled
        parsing
        error="retry"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Video link" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Upload video" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Paste recipe text" })).toBeDisabled();
    expect(screen.getByLabelText("YouTube, TikTok, or RedNote URL")).toBeDisabled();
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
    expect(screen.getByLabelText("Paste recipe text")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Optional details" })).toBeDisabled();
    expect(screen.getByLabelText("Title (optional)")).toBeDisabled();
    expect(screen.getByLabelText("Notes (optional)")).toBeDisabled();
    expect(screen.getByRole("group", { name: "Tags (optional)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quick" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preparing your draft…" })).toBeDisabled();
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

    await user.type(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), "https://youtu.be/dQw4w9WgXcQ");
    expect(onChange).toHaveBeenCalled();
  });

  it("offers manual video upload between the existing source choices when enabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <ImportSourceStep values={values} mediaEnabled parsing={false} error={null} onChange={onChange} onSubmit={vi.fn()} />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Video link", "Upload video", "Paste recipe text",
    ]);
    await user.click(screen.getByRole("tab", { name: "Upload video" }));
    expect(onChange).toHaveBeenCalledWith({ ...values, mode: "media" });

    rerender(<ImportSourceStep values={values} parsing={false} error={null} onChange={onChange} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "Upload video" })).not.toBeInTheDocument();
  });

  it("submits copied RedNote share text without browser URL validation blocking it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const shareText = "好吃到跺脚的擂辣椒烧排骨 😆 https://www.xiaohongshu.com/discovery/item/69eaf618000000001a035987?xsec_token=share_token";
    render(
      <ImportSourceStep values={{ ...values, url: shareText }} parsing={false} error={null} onChange={vi.fn()} onSubmit={onSubmit} />,
    );

    const input = screen.getByLabelText("YouTube, TikTok, or RedNote URL") as HTMLInputElement;
    expect(input).toHaveValue(shareText);
    expect(input.checkValidity()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("shows the shared video name and server-provided size limit without requiring the file picker", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const media = new File(["video"], "擂辣椒烧排骨.mp4", { type: "video/mp4" });
    render(
      <ImportSourceStep values={{ ...values, mode: "media" }} mediaEnabled maxMediaBytes={30 * 1024 * 1024} media={media}
        parsing={false} error={null} onChange={vi.fn()} onSubmit={onSubmit} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Selected: 擂辣椒烧排骨.mp4");
    expect(screen.getByText("Maximum file size: 30 MB.")).toBeVisible();
    expect((screen.getByLabelText("Upload video") as HTMLInputElement).files).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("passes a manually selected video to the existing media import flow", async () => {
    const user = userEvent.setup();
    const onMediaChange = vi.fn();
    const media = new File(["video"], "recipe.mov", { type: "video/quicktime" });
    render(
      <ImportSourceStep values={{ ...values, mode: "media" }} mediaEnabled onMediaChange={onMediaChange}
        parsing={false} error={null} onChange={vi.fn()} onSubmit={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
    await user.upload(screen.getByLabelText("Upload video"), media);
    expect(onMediaChange).toHaveBeenCalledWith(media);
  });

  it.each([
    ["", "This file is empty. Choose another video."],
    ["too large", "This file exceeds the upload limit. Choose a shorter or smaller file."],
  ])("blocks an invalid file and explains how to recover (%s)", (content, message) => {
    render(
      <ImportSourceStep values={{ ...values, mode: "media" }} mediaEnabled maxMediaBytes={2}
        media={new File([content], "recipe.mp4", { type: "video/mp4" })}
        parsing={false} error={null} onChange={vi.fn()} onSubmit={vi.fn()} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  });

  it.each([15 * 1024 * 1024, 30 * 1024 * 1024])("accepts a %i-byte video under the server's 30MiB limit", (size) => {
    render(
      <ImportSourceStep values={{ ...values, mode: "media" }} mediaEnabled maxMediaBytes={30 * 1024 * 1024}
        media={new File([new Uint8Array(size)], "recipe.mp4", { type: "video/mp4" })}
        parsing={false} error={null} onChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
  });

  it("blocks a video one byte over the server's 30MiB limit", () => {
    render(
      <ImportSourceStep values={{ ...values, mode: "media" }} mediaEnabled maxMediaBytes={30 * 1024 * 1024}
        media={new File([new Uint8Array(30 * 1024 * 1024 + 1)], "recipe.mp4", { type: "video/mp4" })}
        parsing={false} error={null} onChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This file exceeds the upload limit.");
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  });
});
