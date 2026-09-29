import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Recipe, RecipeImportJob } from "@cooking/shared";
import ImportPage from "./page";
const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(), importCapabilities: vi.fn(), createImportJob: vi.fn(), getImportJob: vi.fn(), cancelImportJob: vi.fn(), createMediaImportJob: vi.fn(),
}));
vi.mock("../lib/api", () => ({ apiFetch: mocks.apiFetch, webApiClient: { recipes: mocks } }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { id: "test-user" }, loading: false }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../components/RequireAuth", () => ({ RequireAuth: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/editorialCopy", () => ({ useEditorialCopy: () => ({ "import.tagline": "Import recipes" }) }));
vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string) => MESSAGE_MAP.en[key] || key };
});
const source = "https://www.youtube.com/watch?v=A6bByqI_TH8";
const partial: Recipe = { id: "partial", title: "Tofu", source_url: source, ingredients: [{ name: "Tofu", quantity: "" }], steps: [], import_review: { status: "needs_review", source_kind: "description", warnings: ["Steps missing."], can_analyze_video: true } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "saved" }), { status: 200 })));
  mocks.importCapabilities.mockResolvedValue({ video_analysis: true, media_upload: true, max_media_bytes: 1000 });
  mocks.createImportJob.mockResolvedValue({ id: "job", status: "completed", recipe: partial });
  mocks.cancelImportJob.mockResolvedValue({ id: "job", status: "cancelled" });
});
afterEach(cleanup);
async function importPartial() {
  render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  await screen.findByLabelText("Recipe title");
}
test("keeps partial drafts and the source link during text recovery", async () => {
  await importPartial();
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  expect(screen.getByText("The original source link will be kept.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Cut the tofu and simmer." } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare updated draft" }));
  await waitFor(() => expect(mocks.createImportJob).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "text", url: source, transcript: expect.stringContaining("Cut the tofu and simmer.") })));
  await screen.findByRole("button", { name: "Keep current draft" });
  expect(screen.getByLabelText("Recipe title")).toHaveValue("Tofu");
});
test("does not replace manual edits until a new analysis is explicitly applied", async () => {
  await importPartial();
  fireEvent.change(screen.getByLabelText("Recipe title"), { target: { value: "My edited title" } });
  mocks.createImportJob.mockResolvedValue({ id: "second", status: "completed", recipe: { ...partial, title: "Analyzed tofu" } });
  fireEvent.click(screen.getByRole("button", { name: "Read steps from video" }));
  await screen.findByRole("button", { name: "Apply new draft" });
  expect(screen.getByLabelText("Recipe title")).toHaveValue("My edited title");
  fireEvent.click(screen.getByRole("button", { name: "Keep current draft" }));
  expect(screen.getByLabelText("Recipe title")).toHaveValue("My edited title");
});
test("job errors retain the input and permit text fallback", async () => {
  mocks.createImportJob.mockResolvedValue({ id: "job", status: "failed", error: { code: "missing", message: "No captions available." } });
  render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("YouTube, TikTok, or RedNote URL")).toHaveValue(source);
  fireEvent.click(screen.getByRole("tab", { name: "Paste recipe text" }));
  expect(screen.getByText("The original source link will be kept.")).toBeVisible();
});
test("unmount cancels a late-created job and never publishes its result", async () => {
  let resolve!: (job: RecipeImportJob) => void;
  mocks.createImportJob.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  view.unmount();
  await act(async () => resolve({ id: "late", status: "queued" }));
  expect(mocks.cancelImportJob).toHaveBeenCalledWith("late");
});
test("capability failure keeps text imports available and hides media upload", async () => {
  mocks.importCapabilities.mockRejectedValue(new Error("Unavailable"));
  render(<ImportPage />);
  await act(async () => undefined);
  expect(screen.queryByRole("tab", { name: "Upload video" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Paste recipe text" }));
  expect(screen.getByLabelText("Paste recipe text")).toBeEnabled();
});

test("honors an intentionally changed video URL while keeping the existing draft", async () => {
  await importPartial();
  fireEvent.click(screen.getByRole("button", { name: "Back to source" }));
  const replacement = "https://www.youtube.com/watch?v=9hE5-98ZeCg";
  fireEvent.change(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), { target: { value: replacement } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  await waitFor(() => expect(mocks.createImportJob).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "link", url: replacement })));
  await screen.findByRole("button", { name: "Keep current draft" });
  expect(screen.getByLabelText("Recipe title")).toHaveValue("Tofu");
});

test("adding recipe text keeps the edited draft visible and cancelling leaves it untouched", async () => {
  await importPartial();
  fireEvent.change(screen.getByLabelText("Recipe title"), { target: { value: "My family tofu" } });
  fireEvent.change(screen.getByLabelText("Ingredient 1"), { target: { value: "Firm tofu" } });
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));

  expect(screen.getByLabelText("Recipe title")).toBeVisible();
  expect(screen.getByLabelText("Recipe title")).toHaveValue("My family tofu");
  expect(screen.getByLabelText("Ingredient 1")).toHaveValue("Firm tofu");
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Slice the tofu." } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByLabelText("Additional recipe text")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Recipe title")).toHaveValue("My family tofu");
  expect(screen.getByLabelText("Ingredient 1")).toHaveValue("Firm tofu");
  expect(mocks.createImportJob).toHaveBeenCalledTimes(1);
});

test("failed additional text leaves the edited original and entered text available", async () => {
  await importPartial();
  fireEvent.change(screen.getByLabelText("Recipe title"), { target: { value: "My edited tofu" } });
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Slice tofu, then simmer." } });
  mocks.createImportJob.mockResolvedValue({ id: "failed-text", status: "failed", error: { message: "Please try the text again." } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare updated draft" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Please try the text again.");
  expect(screen.getByLabelText("Recipe title")).toHaveValue("My edited tofu");
  expect(screen.getByLabelText("Recipe title")).toBeEnabled();
  expect(screen.getByLabelText("Additional recipe text")).toHaveValue("Slice tofu, then simmer.");
  expect(screen.queryByRole("button", { name: "Apply new draft" })).not.toBeInTheDocument();
});

test("additional text offers a candidate and only explicit approval replaces the edited original", async () => {
  await importPartial();
  fireEvent.change(screen.getByLabelText("Recipe title"), { target: { value: "My edited tofu" } });
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Slice tofu, then simmer." } });
  mocks.createImportJob.mockResolvedValue({ id: "new-text", status: "completed", recipe: { ...partial, title: "Updated tofu", ingredients: [{ name: "Tofu cubes", quantity: "300 g" }] } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare updated draft" }));
  await screen.findByRole("button", { name: "Apply new draft" });

  expect(screen.getByLabelText("Recipe title")).toHaveValue("My edited tofu");
  expect(screen.getByLabelText("Ingredient 1")).toHaveValue("Tofu");
  fireEvent.click(screen.getByRole("button", { name: "Apply new draft" }));
  expect(screen.getByLabelText("Recipe title")).toHaveValue("Updated tofu");
  expect(screen.getByLabelText("Ingredient 1")).toHaveValue("Tofu cubes");
});

test("cancelling additional-text preparation suppresses a late completed candidate", async () => {
  await importPartial();
  fireEvent.change(screen.getByLabelText("Recipe title"), { target: { value: "Keep my edits" } });
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Slice tofu." } });
  let resolve!: (job: RecipeImportJob) => void;
  mocks.createImportJob.mockImplementation(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare updated draft" }));
  expect(screen.getByLabelText("Recipe title")).toBeVisible();
  expect(screen.getByLabelText("Recipe title")).toHaveValue("Keep my edits");
  fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
  await act(async () => resolve({ id: "late-text", status: "completed", recipe: { ...partial, title: "Late replacement" } }));

  expect(screen.getByLabelText("Recipe title")).toHaveValue("Keep my edits");
  expect(screen.getByLabelText("Additional recipe text")).toHaveValue("Slice tofu.");
  expect(screen.queryByRole("button", { name: "Apply new draft" })).not.toBeInTheDocument();
});

test.each(["video", "media"] as const)("does not offer redundant video analysis for %s evidence", async sourceKind => {
  mocks.createImportJob.mockResolvedValue({ id: "analyzed", status: "completed", recipe: {
    ...partial, import_review: { ...partial.import_review!, source_kind: sourceKind },
  } });
  await importPartial();
  expect(screen.queryByRole("button", { name: "Read steps from video" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add recipe text" })).toBeVisible();
});

test("review details collapse and deduplicate repeated warnings", async () => {
  mocks.createImportJob.mockResolvedValue({ id: "warnings", status: "completed", recipe: {
    ...partial, import_review: { ...partial.import_review!, warnings: ["Steps missing.", "  Steps   missing.  ", "Check the heat."] },
  } });
  await importPartial();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Steps missing.")).not.toBeVisible();
  fireEvent.click(screen.getByText("Details to check"));
  expect(screen.getAllByText("Steps missing.")).toHaveLength(1);
  expect(screen.getByText("Check the heat.")).toBeVisible();
});

test("hides internal-only review details while keeping the positive draft and raw diagnostics", async () => {
  const diagnostics = ["Garlic is prepared but no later use is explained; check the source.", "The completeness check omitted or changed previously identified source actions."];
  mocks.createImportJob.mockResolvedValueOnce({ id: "internal", status: "completed", recipe: {
    ...partial, import_review: { ...partial.import_review!, warnings: diagnostics },
  } });
  await importPartial();
  expect(screen.getByText("Your draft is ready")).toBeVisible();
  expect(screen.queryByText("Details to check")).not.toBeInTheDocument();
  for (const warning of diagnostics) expect(screen.queryByText(warning)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());
  expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body).import_review.warnings).toEqual(diagnostics);
});

test("review details retain actionable notices among internal diagnostics", async () => {
  const useful = "The source did not provide a usable cooking method. Add the missing steps before cooking.";
  const internal = "Some instructions could not be verified against source evidence.";
  mocks.createImportJob.mockResolvedValueOnce({ id: "mixed", status: "completed", recipe: {
    ...partial, import_review: { ...partial.import_review!, warnings: [internal, useful, "The amount of salt is not specified."] },
  } });
  await importPartial();
  fireEvent.click(screen.getByText("Details to check"));
  expect(screen.getByText(useful)).toBeVisible();
  expect(screen.getByText("The amount of salt is not specified.")).toBeVisible();
  expect(screen.queryByText(internal)).not.toBeInTheDocument();
});

test("preparing replaces the source form and cancellation restores its inputs", async () => {
  let resolve!: (job: RecipeImportJob) => void;
  mocks.createImportJob.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  expect(screen.queryByLabelText("YouTube, TikTok, or RedNote URL")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create recipe manually" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
  expect(screen.getByLabelText("YouTube, TikTok, or RedNote URL")).toHaveValue(source);
  await act(async () => resolve({ id: "late-source", status: "completed", recipe: partial }));
  expect(screen.queryByLabelText("Recipe title")).not.toBeInTheDocument();
});


test("additional text submits the edited current recipe as context for its candidate", async () => {
  mocks.createImportJob.mockResolvedValue({ id: "with-steps", status: "completed", recipe: {
    ...partial, steps: [{ id: "first", text: "Cut the tofu.", duration_seconds: 180, duration_source: "estimated" }],
  } });
  await importPartial();
  fireEvent.change(screen.getByLabelText("Recipe title"), { target: { value: "Family tofu" } });
  fireEvent.change(screen.getByLabelText("Ingredient 1"), { target: { value: "Firm tofu" } });
  fireEvent.change(screen.getByDisplayValue("Cut the tofu."), { target: { value: "Slice the tofu into thick strips." } });
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Finish with sesame oil." } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare updated draft" }));
  await screen.findByRole("button", { name: "Apply new draft" });
  expect(mocks.createImportJob).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "Family tofu",
    transcript: expect.stringContaining("Slice the tofu into thick strips."),
  }));
  const request = mocks.createImportJob.mock.calls.at(-1)![0];
  expect(request.transcript).toContain("Firm tofu");
  expect(request.transcript).toContain("Finish with sesame oil.");
  expect(screen.getByLabelText("Recipe title")).toHaveValue("Family tofu");
  expect(screen.getByDisplayValue("Slice the tofu into thick strips.")).toBeVisible();
});


test("additional text does not turn estimated timer metadata into source evidence", async () => {
  mocks.createImportJob.mockResolvedValue({ id: "estimated-step", status: "completed", recipe: {
    ...partial, steps: [{ id: "first", text: "Cut the tofu.", duration_seconds: 180, duration_source: "estimated" }],
  } });
  await importPartial();
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Finish with sesame oil." } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare updated draft" }));
  await screen.findByRole("button", { name: "Apply new draft" });
  const request = mocks.createImportJob.mock.calls.at(-1)![0];
  expect(request.transcript).toContain("Cut the tofu.");
  expect(request.transcript).not.toContain("180");
});


test("video recovery from an edited source uses the newly entered URL", async () => {
  await importPartial();
  fireEvent.click(screen.getByRole("button", { name: "Back to source" }));
  const replacement = "https://www.youtube.com/watch?v=9hE5-98ZeCg";
  fireEvent.change(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), { target: { value: replacement } });
  mocks.createImportJob.mockResolvedValueOnce({ id: "failed-link", status: "failed", error: { message: "Captions unavailable." } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Read steps from video" }));
  await screen.findByRole("button", { name: "Apply new draft" });
  expect(mocks.createImportJob).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "video", url: replacement }));
});


const reviewedStep = { id: "original-step", text: "Cut tofu.", duration_seconds: 75, duration_source: "user" as const, instruction_source: "source" as const, source_start_seconds: 42, source_end_seconds: 48, source_excerpt: "Cut tofu into slices." };
async function requestAdditionalCandidate(recipe: Recipe) {
  fireEvent.click(screen.getByRole("button", { name: "Add recipe text" }));
  fireEvent.change(screen.getByLabelText("Additional recipe text"), { target: { value: "Finish with sesame oil." } });
  mocks.createImportJob.mockResolvedValueOnce({ id: "candidate", status: "completed", recipe });
  fireEvent.click(screen.getByRole("button", { name: "Prepare updated draft" }));
  await screen.findByRole("button", { name: "Apply new draft" });
}

test.each([{ total: 45, expectedTotal: 45 }, { total: 2, expectedTotal: 2 }])("applying additional text preserves omitted edits, verified moments and manual timers (total $total)", async ({ total, expectedTotal }) => {
  mocks.createImportJob.mockResolvedValueOnce({ id: "detailed", status: "completed", recipe: {
    ...partial, thumbnail_url: "https://example.com/my-cover.jpg", library_tags: ["chinese", "weeknight"], description: "Original description", tips: ["Dry the tofu well."], equipment: ["Cast iron pan"],
    ingredients: [{ name: "Tofu", quantity: "1 block", metric_quantity: "200 g" }], steps: [reviewedStep], total_time_minutes: total,
  } });
  await importPartial();
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Family version" } });
  fireEvent.change(screen.getByLabelText("Metric equivalent (optional) 1"), { target: { value: "300 g" } });
  await requestAdditionalCandidate({
    ...partial, id: "updated", description: null, tips: [], equipment: [], total_time_minutes: 3,
    ingredients: [{ name: "Tofu", quantity: "1 block", metric_quantity: "" }],
    steps: [{ id: "generated-step", text: "Cut tofu.", duration_seconds: 180, duration_source: "estimated" }],
  });
  const request = mocks.createImportJob.mock.calls.at(-1)![0];
  expect(request.transcript).toContain("Family version");
  expect(request.transcript).toContain("300 g");
  expect(request.transcript).toContain("Dry the tofu well.");
  expect(request.transcript).not.toContain("Cast iron pan");
  expect(request.transcript).not.toContain("Equipment:");
  expect(request.transcript).not.toContain("75");
  const preview = screen.getByRole("region", { name: /New analysis is ready/ });
  expect(within(preview).getByText("1:15 · Adjusted")).toBeVisible();
  expect(preview).toHaveTextContent(`Total time: ${expectedTotal} min`);
  fireEvent.click(screen.getByRole("button", { name: "Apply new draft" }));
  expect(screen.getByLabelText("Description")).toHaveValue("Family version");
  expect(screen.getByLabelText("Metric equivalent (optional) 1")).toHaveValue("300 g");
  expect(screen.getByLabelText("Total time")).toHaveValue(expectedTotal);
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());
  const saved = JSON.parse(mocks.apiFetch.mock.calls[0][1].body);
  expect(saved).not.toHaveProperty("equipment");
  expect(saved).toMatchObject({ thumbnail_url: "https://example.com/my-cover.jpg", library_tags: ["chinese", "weeknight"], description: "Family version", tips: ["Dry the tofu well."], total_time_minutes: expectedTotal, steps: [reviewedStep] });
});

test("changed candidate instructions do not inherit old source moments or timers", async () => {
  mocks.createImportJob.mockResolvedValueOnce({ id: "detailed", status: "completed", recipe: { ...partial, steps: [reviewedStep], total_time_minutes: 2 } });
  await importPartial();
  await requestAdditionalCandidate({
    ...partial, id: "updated", description: "New description", tips: ["New tip"], equipment: ["Wok"], total_time_minutes: 5,
    steps: [{ id: "new-step", text: "Simmer tofu in sauce.", duration_seconds: 300, duration_source: "estimated" }],
  });
  const preview = screen.getByRole("region", { name: /New analysis is ready/ });
  expect(within(preview).getByText("5:00 · Estimated")).toBeVisible();
  expect(preview).toHaveTextContent("Estimated total: 5 min");
  expect(preview).not.toHaveTextContent("Wok");
  fireEvent.click(screen.getByRole("button", { name: "Apply new draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());
  const saved = JSON.parse(mocks.apiFetch.mock.calls[0][1].body);
  expect(saved).not.toHaveProperty("equipment");
  expect(saved).toMatchObject({ description: "New description", tips: ["New tip"], total_time_minutes: 5 });
  expect(saved.steps[0]).toMatchObject({ id: "new-step", text: "Simmer tofu in sauce.", duration_seconds: 300, duration_source: "estimated" });
  expect(saved.steps[0].source_start_seconds ?? null).toBeNull();
  expect(saved.steps[0].source_excerpt ?? null).toBeNull();
});

test.each(["additional text", "video analysis"])("applying %s keeps cover and tag choices made after the candidate is ready", async (mode) => {
  mocks.createImportJob.mockResolvedValueOnce({ id: "original", status: "completed", recipe: {
    ...partial, thumbnail_url: "https://example.com/original-cover.jpg", library_tags: ["chinese"],
  } });
  mocks.apiFetch.mockImplementation((path: string) => Promise.resolve(new Response(JSON.stringify(path === "/recipes/upload-image"
    ? { upload_url: "", file_url: "https://example.com/latest-cover.jpg" }
    : { id: "saved" }))));
  await importPartial();
  const replacement: Recipe = { ...partial, id: "updated", title: "Updated method", thumbnail_url: "https://example.com/model-cover.jpg", library_tags: ["weeknight"] };
  if (mode === "additional text") await requestAdditionalCandidate(replacement);
  else {
    mocks.createImportJob.mockResolvedValueOnce({ id: "analyzed", status: "completed", recipe: replacement });
    fireEvent.click(screen.getByRole("button", { name: "Read steps from video" }));
    await screen.findByRole("button", { name: "Apply new draft" });
  }

  // An intentionally empty tag selection must remain empty after applying a method update.
  fireEvent.click(screen.getByRole("button", { name: "Chinese" }));
  fireEvent.change(screen.getByLabelText("Cover image"), { target: { files: [new File(["photo"], "dish.jpg", { type: "image/jpeg" })] } });
  await screen.findByText("Cover photo updated");
  fireEvent.click(screen.getByRole("button", { name: "Apply new draft" }));
  expect(screen.getByRole("img", { name: "Cover image" })).toHaveAttribute("src", "https://example.com/latest-cover.jpg");
  expect(screen.getByRole("button", { name: "Chinese" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("Recipe title")).toHaveValue("Updated method");
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(mocks.apiFetch.mock.calls.some(([path]) => path === "/recipes")).toBe(true));
  const saved = JSON.parse(mocks.apiFetch.mock.calls.find(([path]) => path === "/recipes")![1].body);
  expect(saved).toMatchObject({ thumbnail_url: "https://example.com/latest-cover.jpg", library_tags: [] });
});

test("ambiguous repeated instructions do not copy a source moment or manual timer to the wrong step", async () => {
  mocks.createImportJob.mockResolvedValueOnce({ id: "detailed", status: "completed", recipe: {
    ...partial, steps: [reviewedStep, { ...reviewedStep, id: "other-original", duration_seconds: 90, source_start_seconds: 120 }],
  } });
  await importPartial();
  await requestAdditionalCandidate({ ...partial, id: "updated", steps: [{ id: "new-step", text: "Cut tofu.", duration_seconds: 180, duration_source: "estimated" }] });
  fireEvent.click(screen.getByRole("button", { name: "Apply new draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());
  const saved = JSON.parse(mocks.apiFetch.mock.calls[0][1].body);
  expect(saved).not.toHaveProperty("equipment");
  expect(saved.steps[0]).toMatchObject({ id: "new-step", duration_seconds: 180, duration_source: "estimated" });
  expect(saved.steps[0].source_start_seconds ?? null).toBeNull();
});
