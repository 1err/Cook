import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Recipe, RecipeImportJob } from "@cooking/shared";
import ImportPage from "./page";
const mocks = vi.hoisted(() => ({
  importCapabilities: vi.fn(), createImportJob: vi.fn(), getImportJob: vi.fn(), cancelImportJob: vi.fn(), createMediaImportJob: vi.fn(),
}));
vi.mock("../lib/api", () => ({ webApiClient: { recipes: mocks } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../components/PageShell", () => ({ PageShell: ({ children }: any) => <div>{children}</div> }));
vi.mock("../components/RequireAuth", () => ({ RequireAuth: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/editorialCopy", () => ({ useEditorialCopy: () => ({ "import.tagline": "Import recipes" }) }));
vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string) => MESSAGE_MAP.en[key] || key };
});
vi.mock("./DraftRecipeEditor", () => ({ DraftRecipeEditor: ({ draft, onChange, onBack, disabled }: any) => <div>
  <p data-testid="draft-title">{draft.title}</p><p>{draft.source_url}</p>
  <button disabled={disabled} onClick={() => onChange({ ...draft, title: "My edited title" })}>Edit title</button>
  <button onClick={onBack}>Back to source</button>
</div> }));
const source = "https://www.youtube.com/watch?v=A6bByqI_TH8";
const partial: Recipe = { id: "partial", title: "Tofu", source_url: source, ingredients: [{ name: "Tofu", quantity: "" }], steps: [], import_review: { status: "needs_review", source_kind: "description", warnings: ["Steps missing."], can_analyze_video: true } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.importCapabilities.mockResolvedValue({ video_analysis: true, media_upload: true, max_media_bytes: 1000 });
  mocks.createImportJob.mockResolvedValue({ id: "job", status: "completed", recipe: partial });
  mocks.cancelImportJob.mockResolvedValue({ id: "job", status: "cancelled" });
});
afterEach(cleanup);
async function importPartial() {
  render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube or TikTok URL"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await screen.findByText("Review incomplete tutorial");
}
test("keeps partial drafts and the source link during text recovery", async () => {
  await importPartial();
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  expect(screen.getByText("The original source link will be kept.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Paste recipe text"), { target: { value: "Cut the tofu and simmer." } });
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await waitFor(() => expect(mocks.createImportJob).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "text", url: source, transcript: "Cut the tofu and simmer." })));
  await screen.findByRole("button", { name: "Keep current draft" });
  expect(screen.getByTestId("draft-title")).toHaveTextContent("Tofu");
});
test("does not replace manual edits until a new analysis is explicitly applied", async () => {
  await importPartial();
  fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
  mocks.createImportJob.mockResolvedValue({ id: "second", status: "completed", recipe: { ...partial, title: "Analyzed tofu" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze video" }));
  await screen.findByRole("button", { name: "Apply new draft" });
  expect(screen.getByTestId("draft-title")).toHaveTextContent("My edited title");
  fireEvent.click(screen.getByRole("button", { name: "Keep current draft" }));
  expect(screen.getByTestId("draft-title")).toHaveTextContent("My edited title");
});
test("job errors retain the input and permit text fallback", async () => {
  mocks.createImportJob.mockResolvedValue({ id: "job", status: "failed", error: { code: "missing", message: "No captions available." } });
  render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube or TikTok URL"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("YouTube or TikTok URL")).toHaveValue(source);
  fireEvent.click(screen.getByRole("tab", { name: "Paste recipe text" }));
  expect(screen.getByText("The original source link will be kept.")).toBeVisible();
});
test("unmount cancels a late-created job and never publishes its result", async () => {
  let resolve!: (job: RecipeImportJob) => void;
  mocks.createImportJob.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube or TikTok URL"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  view.unmount();
  await act(async () => resolve({ id: "late", status: "queued" }));
  expect(mocks.cancelImportJob).toHaveBeenCalledWith("late");
});
test("capability failure keeps text imports available and hides media upload", async () => {
  mocks.importCapabilities.mockRejectedValue(new Error("Unavailable"));
  render(<ImportPage />);
  await act(async () => undefined);
  expect(screen.queryByRole("tab", { name: "Upload video or audio" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Paste recipe text" }));
  expect(screen.getByLabelText("Paste recipe text")).toBeEnabled();
});

test("honors an intentionally changed video URL while keeping the existing draft", async () => {
  await importPartial();
  fireEvent.click(screen.getByRole("button", { name: "Back to source" }));
  const replacement = "https://www.youtube.com/watch?v=9hE5-98ZeCg";
  fireEvent.change(screen.getByLabelText("YouTube or TikTok URL"), { target: { value: replacement } });
  fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
  await waitFor(() => expect(mocks.createImportJob).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "link", url: replacement })));
  await screen.findByRole("button", { name: "Keep current draft" });
  expect(screen.getByTestId("draft-title")).toHaveTextContent("Tofu");
});
