import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@cooking/api-client";
import { MESSAGE_MAP } from "@cooking/shared";
import { MediaReviewQueue } from "./MediaReviewQueue";
const { list, review, actor } = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn(), actor: { id: "admin-1" } }));
vi.mock("../lib/api", () => ({ webApiClient: { mediaReview: { list, review } } }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: actor }) }));
vi.mock("../lib/i18n", () => ({ useT: () => (key: string) => MESSAGE_MAP.en[key] ?? key }));
const photoSet = { id: "media-1", owner_id: "owner", recipe_id: "recipe-1", media_digest: "a".repeat(64), eligible_media_urls: ["https://assets.example.test/cover.png", "https://assets.example.test/step.png"], status: "pending", created_at: "2026-10-13T12:00:00Z", recipe: { title: "Review photos", thumbnail_url: "https://assets.example.test/cover.png", ingredients: [], steps: [{ text: "Cook", image_url: "https://assets.example.test/step.png" }], raw_extraction_text: "Private source guidance" } };
beforeEach(() => { vi.clearAllMocks(); actor.id = "admin-1"; list.mockResolvedValue({ reviews: [photoSet], total: 1 }); review.mockResolvedValue({ ...photoSet, status: "approved" }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("inspects cover and step candidates and submits the displayed digest after confirmation", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<MediaReviewQueue />);
  await screen.findByRole("heading", { name: "Review photos" });
  expect(screen.getByAltText("Recipe cover")).toHaveAttribute("src", photoSet.recipe.thumbnail_url);
  expect(screen.getByAltText("Step 1")).toHaveAttribute("src", photoSet.recipe.steps[0].image_url);
  expect(screen.queryByText("Private source guidance")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve photos" }));
  expect(review).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  list.mockResolvedValue({ reviews: [], total: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Approve photos" }));
  await waitFor(() => expect(review).toHaveBeenCalledWith("media-1", "approve", photoSet.media_digest, undefined, "admin-1"));
  expect(await screen.findByText("No pending photo sets.")).toBeVisible();
});

test("a stale photo-set rejection explains that refresh is required", async () => {
  review.mockRejectedValueOnce(new ApiError("Photos changed", 409));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<MediaReviewQueue />);
  await screen.findByRole("heading", { name: "Review photos" });
  fireEvent.click(screen.getByRole("button", { name: "Approve photos" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(MESSAGE_MAP.en["safety.photosChanged"]);
});

test("a late pending-queue response is discarded after an account switch", async () => {
  let finish!: (value: unknown) => void;
  list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<MediaReviewQueue />);
  actor.id = "admin-2";
  list.mockResolvedValue({ reviews: [], total: 0 });
  rerender(<MediaReviewQueue />);
  await screen.findByText("No pending photo sets.");
  await act(async () => { finish({ reviews: [photoSet], total: 1 }); });
  expect(screen.queryByRole("heading", { name: "Review photos" })).not.toBeInTheDocument();
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ expectedAccountId: "admin-2" }));
});
