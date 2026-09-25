import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@cooking/api-client";
import { RecipeImageGenerator } from "./RecipeImageGenerator";

const { access, generate, status } = vi.hoisted(() => ({ access: vi.fn(), generate: vi.fn(), status: vi.fn() }));
vi.mock("../lib/api", () => ({
  webApiClient: { recipes: { imageGenerationAccess: access, generateImage: generate, imageGenerationStatus: status } },
}));
vi.mock("../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "imageGeneration.title": "AI cover image",
      "imageGeneration.description": "Create a cover from your recipe, then choose whether to use it.",
      "imageGeneration.generate": "Generate with AI",
      "imageGeneration.generating": "Generating image…",
      "imageGeneration.useImage": "Use image",
      "imageGeneration.discard": "Discard",
      "imageGeneration.preview": "Generated cover preview",
      "imageGeneration.aiGenerated": "AI-generated",
      "imageGeneration.remaining": "{remaining} of {limit} attempts left today.",
      "imageGeneration.limitReached": "Daily limit reached.",
      "imageGeneration.rateLimited": "Please wait a moment before creating another image.",
      "imageGeneration.budgetLimit": "The monthly AI budget has been reached.",
      "imageGeneration.storageLimit": "The image storage allowance has been reached.",
      "imageGeneration.membershipRequired": "Paid membership required.",
      "imageGeneration.unavailable": "AI images are unavailable right now.",
      "imageGeneration.failed": "Couldn't generate the image. Please try again.",
      "imageGeneration.needTitle": "Add a recipe title first.",
      "imageGeneration.loading": "Checking availability…",
      "imageGeneration.checkAgain": "Check again",
      "imageGeneration.attemptsNote": "Each generation uses one attempt.",
    };
    return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
  },
}));

const recipe = {
  title: "Braised tofu",
  description: "Glossy tofu and eggplant.",
  ingredients: [{ name: "Tofu", quantity: "1 block" }, { name: "Eggplant", quantity: "2" }],
  steps: [{ text: "Braise in a clay pot." }],
};
const available = { enabled: true, allowed: true, reason: null, daily_limit: 3, remaining: 3, resets_at: "2026-09-26T00:00:00Z" };
const completed = { request_id: "ignored-by-fixture", status: "completed", file_url: "https://images.example/ai-cover.webp" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => {
  access.mockReset().mockResolvedValue(available);
  generate.mockReset().mockImplementation(async (payload) => ({ ...completed, request_id: payload.request_id }));
  status.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("RecipeImageGenerator", () => {
  it("previews an image without changing the recipe until the user accepts it", async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={onAccept} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("img", { name: "Generated cover preview" })).toHaveAttribute("src", completed.file_url);
    expect(screen.getByText("AI-generated")).toBeVisible();
    expect(onAccept).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      title: "Braised tofu", ingredients: ["Tofu", "Eggplant"], steps: ["Braise in a clay pot."],
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await user.click(screen.getByRole("button", { name: "Use image" }));
    expect(onAccept).toHaveBeenCalledWith(completed.file_url);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("discards a candidate without overwriting the existing cover", async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={onAccept} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("prevents a second generation while the first request is in flight", async () => {
    const pending = deferred<typeof completed>();
    generate.mockReturnValueOnce(pending.promise);
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Generate with AI" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Generating image…" })).toBeDisabled();
    await act(async () => { pending.resolve(completed); });
  });

  it.each([
    ["daily_limit", "Daily limit reached."],
    ["membership_required", "Paid membership required."],
    ["disabled", "AI images are unavailable right now."],
  ])("blocks generation when access reports %s", async (reason, message) => {
    access.mockResolvedValue({ ...available, allowed: false, remaining: 0, reason });
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate with AI" })).toBeDisabled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("offers availability recovery without generating after an access network error", async () => {
    access.mockRejectedValueOnce(new TypeError("Network failure"));
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    expect(await screen.findByText("AI images are unavailable right now.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate with AI" })).toBeEnabled());
    expect(generate).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous POST through status without submitting another generation", async () => {
    generate.mockRejectedValueOnce(new TypeError("Network disconnected"));
    status.mockImplementation(async (requestId) => ({ ...completed, request_id: requestId }));
    const onAccept = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={onAccept} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("img", { name: "Generated cover preview" })).toBeVisible();
    expect(status).toHaveBeenCalledWith(generate.mock.calls[0][0].request_id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("checks an unresolved request again without issuing another POST", async () => {
    generate.mockRejectedValueOnce(new TypeError("Network disconnected"));
    status.mockRejectedValueOnce(new TypeError("Still offline"));
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't generate the image");
    status.mockImplementation(async (requestId) => ({ ...completed, request_id: requestId }));
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("img")).toBeVisible();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("manually recovers a missing attempt by replaying the original payload and request ID", async () => {
    generate.mockRejectedValueOnce(new TypeError("POST never reached the server"));
    status.mockRejectedValue(new ApiError("Image request not found", 404, "not_found"));
    const user = userEvent.setup();
    const { rerender } = render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    await screen.findByRole("alert");
    expect(generate).toHaveBeenCalledTimes(1);
    const originalPayload = generate.mock.calls[0][0];
    rerender(<RecipeImageGenerator recipe={{ ...recipe, title: "Changed title", ingredients: [{ name: "Chicken", quantity: "1" }] }} onAccept={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("img", { name: "Generated cover preview" })).toBeVisible();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toEqual(originalPayload);
    expect(generate.mock.calls[1][0]).toMatchObject({ title: "Braised tofu", ingredients: ["Tofu", "Eggplant"] });
  });

  it("polls pending results and aborts the current request on unmount", async () => {
    generate.mockImplementation(async ({ request_id }) => ({ request_id, status: "pending", file_url: null }));
    status.mockImplementation(async (request_id) => ({ request_id, status: "pending", file_url: null }));
    const user = userEvent.setup();
    const { unmount } = render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    const signal = generate.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("keeps a completed candidate but prevents acceptance while its editor is saving", async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<RecipeImageGenerator recipe={recipe} onAccept={onAccept} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    await screen.findByRole("img");
    rerender(<RecipeImageGenerator recipe={recipe} onAccept={onAccept} disabled />);
    expect(screen.getByRole("button", { name: "Use image" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use image" }));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("surfaces a rejected allowance without polling or changing the cover", async () => {
    generate.mockRejectedValueOnce(new ApiError("Daily quota exhausted", 429, "daily_limit"));
    const onAccept = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={onAccept} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily limit reached.");
    expect(status).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("does not call a shared service limit the user's daily allowance", async () => {
    generate.mockRejectedValueOnce(new ApiError("Global quota exhausted", 429, "global_limit"));
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI images are unavailable right now.");
  });

  it("explains the short pause when requests arrive too quickly", async () => {
    generate.mockRejectedValueOnce(new ApiError("Slow down", 429, "rate_limited"));
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please wait a moment before creating another image.");
  });

  it.each([
    ["budget_limit", "The monthly AI budget has been reached."],
    ["storage_limit", "The image storage allowance has been reached."],
  ])("explains %s for rejected and completed failed attempts", async (code, message) => {
    generate.mockRejectedValueOnce(new ApiError("Limited", 429, code));
    const user = userEvent.setup();
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    generate.mockResolvedValueOnce({ request_id: "attempt", status: "failed", file_url: null, error_code: code });
    await user.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("polls a pending request until completion without submitting a new request", async () => {
    generate.mockImplementation(async ({ request_id }) => ({ request_id, status: "pending", file_url: null }));
    status.mockResolvedValueOnce({ request_id: "pending", status: "pending", file_url: null }).mockResolvedValueOnce(completed);
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Generate with AI" });
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(button); });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole("img", { name: "Generated cover preview" })).toBeVisible();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("stops pending polling after 90 seconds and allows checking the same attempt", async () => {
    generate.mockImplementation(async ({ request_id }) => ({ request_id, status: "pending", file_url: null }));
    status.mockImplementation(async (request_id) => ({ request_id, status: "pending", file_url: null }));
    render(<RecipeImageGenerator recipe={recipe} onAccept={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Generate with AI" });
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(button); });
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
    const callsAfterTimeout = status.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(status).toHaveBeenCalledTimes(callsAfterTimeout);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
