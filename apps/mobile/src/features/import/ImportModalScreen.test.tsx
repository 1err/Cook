import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { Recipe, RecipeImportJob } from "@cooking/shared";
import { ImportModalScreen } from "./ImportModalScreen";

const parsedDraft: Recipe = {
  id: "draft",
  title: "Imported noodles",
  source_url: "https://www.youtube.com/watch?v=A6bByqI_TH8",
  import_review: { status: "needs_review", warnings: ["Finishing steps could not be verified."], source_kind: "captions", can_analyze_video: true },
  thumbnail_url: null,
  ingredients: [{ name: "Noodles", quantity: "200g" }],
  steps: [{
    id: "8b407c84-3888-435a-94a7-88bf4f80fa66",
    text: "Boil the noodles.",
    duration_seconds: 300,
    duration_source: "fallback",
    attention_type: "hands_on",
    action_type: "boil",
    image_url: "https://example.com/preserved.jpg",
  }],
};

const mockParseLink = jest.fn();
const mockParseTranscript = jest.fn();
const mockCreate = jest.fn();
const mockCapabilities = jest.fn();
const mockJobCreate = jest.fn();
const mockMediaCreate = jest.fn();
const mockJobGet = jest.fn();
const mockJobCancel = jest.fn();
const mockPickVideo = jest.fn();
const mockPermission = jest.fn();
const mockApiClient = {
  recipes: {
    parseLink: mockParseLink,
    parseTranscript: mockParseTranscript,
    create: mockCreate,
    uploadImage: jest.fn(),
    importCapabilities: mockCapabilities,
    createImportJob: mockJobCreate,
    createMediaImportJob: mockMediaCreate,
    getImportJob: mockJobGet,
    cancelImportJob: mockJobCancel,
  },
};
let mockSelectedApiClient = mockApiClient;
const originalFormData = globalThis.FormData;

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockSelectedApiClient,
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: () => mockPermission(),
  launchImageLibraryAsync: (options: unknown) => mockPickVideo(options),
}));

jest.mock("../../lib/i18n", () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) => {
    const { MESSAGE_MAP } = require("@cooking/shared") as typeof import("@cooking/shared");
    const template = MESSAGE_MAP.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(variables?.[name] ?? ""));
  },
}));

function navigation() {
  const parentNavigate = jest.fn();
  return {
    parentNavigate,
    value: {
      setOptions: jest.fn(),
      goBack: jest.fn(),
      getParent: () => ({ navigate: parentNavigate }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedApiClient = mockApiClient;
  globalThis.FormData = jest.requireActual("react-native/Libraries/Network/FormData").default;
  mockParseLink.mockResolvedValue(parsedDraft);
  mockParseTranscript.mockResolvedValue(parsedDraft);
  mockCreate.mockResolvedValue({ ...parsedDraft, id: "saved-recipe" });
  mockCapabilities.mockResolvedValue({ video_analysis: true, media_upload: true, max_media_bytes: 14 * 1024 * 1024 });
  mockJobCreate.mockImplementation(async (payload) => ({ id: "job-1", status: "completed", recipe: await (payload.mode === "text" ? mockParseTranscript(payload) : mockParseLink(payload)) }));
  mockMediaCreate.mockResolvedValue({ id: "media-job", status: "completed", recipe: parsedDraft });
  mockJobCancel.mockResolvedValue({ id: "job-1", status: "cancelled" });
  mockPermission.mockResolvedValue({ granted: true });
  mockPickVideo.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///movie.mp4", fileName: "movie.mp4", mimeType: "video/mp4", fileSize: 1024 }] });
});

afterEach(() => { globalThis.FormData = originalFormData; });

test("keeps internal-only diagnostics out of review while preserving them on the saved draft", async () => {
  const diagnostics = ["Garlic is prepared but no later use is explained; check the source.", "The tutorial completeness check could not finish. Review the method against the source."];
  mockParseLink.mockResolvedValueOnce({ ...parsedDraft, import_review: { ...parsedDraft.import_review!, warnings: diagnostics } });
  await render(<ImportModalScreen navigation={navigation().value as never} route={{} as never} />);
  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/example");
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  expect(await screen.findByText("Your draft is ready")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Details to check" })).not.toBeOnTheScreen();
  for (const diagnostic of diagnostics) expect(screen.queryByText(diagnostic)).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate.mock.calls[0][0].import_review.warnings).toEqual(diagnostics);
});

test("shows only actionable deduplicated review notices", async () => {
  const missing = "The source did not provide a usable cooking method. Add the missing steps before cooking.";
  const internal = "The completeness check omitted or changed previously identified source actions.";
  mockParseLink.mockResolvedValueOnce({ ...parsedDraft, import_review: { ...parsedDraft.import_review!, warnings: [internal, missing, "  The amount of salt is not specified.  ", "The amount of salt is not specified."] } });
  await render(<ImportModalScreen navigation={navigation().value as never} route={{} as never} />);
  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/example");
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  expect(await screen.findByText(missing)).toBeOnTheScreen();
  expect(screen.getAllByText("The amount of salt is not specified.")).toHaveLength(1);
  expect(screen.queryByText(internal)).not.toBeOnTheScreen();
});

test("reviews imported tutorial metadata and saves user edits without dropping hidden images", async () => {
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);

  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/example");
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));

  expect(await screen.findByText("About 5 min · Rough estimate · Hands-on")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Passive" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save recipe" }));

  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  const saved = mockCreate.mock.calls[0][0] as Recipe;
  expect(saved.steps?.[0]).toEqual({
    ...parsedDraft.steps?.[0],
    attention_type: "passive",
  });
  expect(nav.parentNavigate).toHaveBeenCalledWith("Main", {
    screen: "Library",
    params: { screen: "RecipeDetail", params: { recipeId: "saved-recipe" } },
  });
});

test("does not save an import while a local tutorial duration is invalid", async () => {
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);

  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/example");
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  const minutes = await screen.findByLabelText("Step 1 minutes");
  await fireEvent.changeText(minutes, "");

  expect(screen.getByRole("button", { name: "Save recipe" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Save recipe" }));
  expect(mockCreate).not.toHaveBeenCalled();
});

test("prefills a shared TikTok URL and previews it through the normal link flow", async () => {
  const nav = navigation();
  await render(
    <ImportModalScreen
      navigation={nav.value as never}
      route={{ params: { initialUrl: "https://vm.tiktok.com/ZMrecipe/" } } as never}
    />,
  );

  expect(screen.getByLabelText("YouTube or TikTok URL")).toHaveDisplayValue("https://vm.tiktok.com/ZMrecipe/");
  expect(screen.getByRole("tab", { name: "Video link" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));

  await waitFor(() =>
    expect(mockParseLink).toHaveBeenCalledWith(expect.objectContaining({ url: "https://vm.tiktok.com/ZMrecipe/" })),
  );
});

test("locks link input and source tabs while a preview is parsing", async () => {
  const nav = navigation();
  mockParseLink.mockImplementationOnce(() => new Promise<Recipe>(() => {}));

  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/example");
  fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));

  await waitFor(() => {
    expect(screen.getByLabelText("YouTube or TikTok URL")).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeDisabled();
  });
});

test("locks transcript and expanded optional controls while a preview is parsing", async () => {
  const nav = navigation();
  mockParseTranscript.mockImplementationOnce(() => new Promise<Recipe>(() => {}));

  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.press(screen.getByRole("tab", { name: "Transcript" }));
  await fireEvent.press(screen.getByRole("button", { name: "Optional details" }));
  await fireEvent.changeText(screen.getByLabelText("Transcript"), "Boil noodles, then toss with sauce.");
  fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));

  await waitFor(() => {
    expect(screen.getByRole("tab", { name: "Video link" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeDisabled();
    expect(screen.getByLabelText("Transcript")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Optional details" })).toBeDisabled();
    expect(screen.getByLabelText("Title (optional)")).toBeDisabled();
    expect(screen.getByLabelText("Notes (optional)")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Quick" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preparing your draft…" })).toBeDisabled();
  });
});

test("preserves a parse error until a source edit or mode change clears it", async () => {
  const nav = navigation();
  mockParseLink.mockRejectedValue(new Error("This TikTok does not expose enough recipe text."));

  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), "https://vm.tiktok.com/ZMrecipe/");
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));

  expect(await screen.findByText("This TikTok does not expose enough recipe text.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Optional details" }));
  expect(screen.getByText("This TikTok does not expose enough recipe text.")).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), "https://youtu.be/dQw4w9WgXcQ");
  expect(screen.queryByText("This TikTok does not expose enough recipe text.")).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  expect(await screen.findByText("This TikTok does not expose enough recipe text.")).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("tab", { name: "Transcript" }));
  expect(screen.queryByText("This TikTok does not expose enough recipe text.")).not.toBeOnTheScreen();
});

test('creates and saves a manual recipe without calling either parsing provider', async () => {
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Create recipe manually' }));
  expect(screen.getByRole('button', { name: 'Save recipe' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Family noodles');
  await fireEvent.changeText(screen.getByLabelText('Ingredient'), 'Noodles');
  await fireEvent.changeText(screen.getByLabelText('Quantity'), '200 g');
  await fireEvent.changeText(screen.getByLabelText('Step 1'), 'Boil noodles.');
  await fireEvent.press(screen.getByRole('button', { name: 'Save recipe' }));
  await waitFor(() => expect(nav.parentNavigate).toHaveBeenCalled());
  expect(mockParseLink).not.toHaveBeenCalled();
  expect(mockParseTranscript).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Family noodles', source_url: null, ingredients: [{ name: 'Noodles', quantity: '200 g' }], steps: [expect.objectContaining({ text: 'Boil noodles.' })] }));
});

test('does not navigate from a save belonging to an unmounted account view', async () => {
  const nav = navigation();
  let finish!: (recipe: Recipe) => void;
  mockCreate.mockImplementation(() => new Promise<Recipe>(resolve => { finish = resolve; }));
  const rendered = await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Create recipe manually' }));
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Noodles');
  await fireEvent.changeText(screen.getByLabelText('Ingredient'), 'Noodles');
  await fireEvent.changeText(screen.getByLabelText('Step 1'), 'Boil noodles.');
  void fireEvent.press(screen.getByRole('button', { name: 'Save recipe' }));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  await rendered.unmount();
  finish({ ...parsedDraft, id: 'previous-user-recipe' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nav.value.goBack).not.toHaveBeenCalled();
  expect(nav.parentNavigate).not.toHaveBeenCalled();
});

test("partial drafts keep the source and edits while reviewing a replacement", async () => {
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), parsedDraft.source_url!);
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  expect(await screen.findByText("Your draft is ready")).toBeOnTheScreen();
  expect(screen.getByText("Finishing steps could not be verified.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Title"), "My carefully edited noodles");
  await fireEvent.press(screen.getByRole("button", { name: "Add recipe text" }));
  await fireEvent.changeText(screen.getByLabelText("Transcript"), "Finish with sesame oil.");
  mockParseTranscript.mockResolvedValueOnce({ ...parsedDraft, title: "Replacement", source_url: null });
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  expect(await screen.findByRole("button", { name: "Apply new draft" })).toBeOnTheScreen();
  expect(screen.getByLabelText("Title")).toHaveDisplayValue("My carefully edited noodles");
  expect(mockJobCreate).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "text", url: parsedDraft.source_url, transcript: "Finish with sesame oil." }));
  await fireEvent.press(screen.getByRole("button", { name: "Keep current draft" }));
  expect(screen.getByLabelText("Title")).toHaveDisplayValue("My carefully edited noodles");
});

test("cancelled background jobs cannot publish a late draft", async () => {
  const nav = navigation();
  let complete!: (job: RecipeImportJob) => void;
  mockJobCreate.mockImplementationOnce(() => new Promise<RecipeImportJob>(resolve => { complete = resolve; }));
  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.changeText(screen.getByLabelText("YouTube or TikTok URL"), parsedDraft.source_url!);
  void fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  await waitFor(() => expect(mockJobCreate).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel import" }));
  await act(async () => { complete({ id: "late-job", status: "queued" }); });
  await waitFor(() => expect(mockJobCancel).toHaveBeenCalledWith("late-job"));
  expect(screen.queryByLabelText("Title")).not.toBeOnTheScreen();
  expect(screen.getByLabelText("YouTube or TikTok URL")).toHaveDisplayValue(parsedDraft.source_url!);
});

test("uploads a selected native video through the media job and preserves source", async () => {
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{ params: { initialUrl: parsedDraft.source_url } } as never} />);
  await fireEvent.press(screen.getByRole("tab", { name: "Choose a video" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Choose a video" }));
  expect(await screen.findByText("Selected: movie.mp4")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  expect(await screen.findByLabelText("Title")).toHaveDisplayValue(parsedDraft.title);
  expect(mockPickVideo).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ["videos"], allowsEditing: false }));
  const form = mockMediaCreate.mock.calls[0][0] as FormData;
  expect((form as unknown as { getParts: () => { fieldName: string; string?: string; uri?: string }[] }).getParts()).toEqual(expect.arrayContaining([
    expect.objectContaining({ fieldName: "source_url", string: parsedDraft.source_url }),
    expect.objectContaining({ fieldName: "file", uri: "file:///movie.mp4" }),
  ]));
});

test("rejects oversized native video before upload", async () => {
  mockPickVideo.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///huge.mp4", fileName: "huge.mp4", mimeType: "video/mp4", fileSize: 15*1024*1024 }] });
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await fireEvent.press(screen.getByRole("tab", { name: "Choose a video" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Choose a video" }));
  expect(await screen.findByText("This file exceeds the upload limit. Choose a shorter or smaller file.")).toBeOnTheScreen();
  expect(mockMediaCreate).not.toHaveBeenCalled();
});

test("unavailable video analysis leaves transcript recovery available", async () => {
  mockCapabilities.mockResolvedValueOnce({ video_analysis: false, media_upload: false, max_media_bytes: 14*1024*1024 });
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{ params: { initialUrl: parsedDraft.source_url } } as never} />);
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  expect(await screen.findByText("Video analysis is unavailable. Paste recipe text or add the missing steps.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Read steps from video" })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Add recipe text" }));
  expect(screen.getByLabelText("Transcript")).toBeOnTheScreen();
  expect(screen.getByText("The original source link will be kept.")).toBeOnTheScreen();
});

test("applies a reviewed candidate only after explicit acceptance", async () => {
  const nav = navigation();
  await render(<ImportModalScreen navigation={nav.value as never} route={{ params: { initialUrl: parsedDraft.source_url } } as never} />);
  await fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  await screen.findByLabelText("Title");
  await fireEvent.changeText(screen.getByLabelText("Title"), "My existing draft");
  mockParseLink.mockResolvedValueOnce({ ...parsedDraft, title: "New video result", source_url: null });
  await fireEvent.press(screen.getByRole("button", { name: "Read steps from video" }));
  expect(await screen.findByRole("button", { name: "Apply new draft" })).toBeOnTheScreen();
  expect(screen.getByLabelText("Title")).toHaveDisplayValue("My existing draft");
  await fireEvent.press(screen.getByRole("button", { name: "Apply new draft" }));
  expect(screen.getByLabelText("Title")).toHaveDisplayValue("New video result");
  await fireEvent.press(screen.getByRole("button", { name: "Save recipe" }));
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ title: "New video result", source_url: parsedDraft.source_url }));
});

test("account changes cancel pending jobs and discard the previous account draft", async () => {
  const nav = navigation();
  let complete!: (job: RecipeImportJob) => void;
  mockJobCreate.mockImplementationOnce(() => new Promise<RecipeImportJob>(resolve => { complete = resolve; }));
  const view = await render(<ImportModalScreen navigation={nav.value as never} route={{ params: { initialUrl: parsedDraft.source_url } } as never} />);
  void fireEvent.press(screen.getByRole("button", { name: "Preview recipe" }));
  await waitFor(() => expect(mockJobCreate).toHaveBeenCalledTimes(1));
  mockSelectedApiClient = { recipes: { ...mockApiClient.recipes } };
  await view.rerender(<ImportModalScreen navigation={nav.value as never} route={{} as never} />);
  await act(async () => { complete({ id: "previous-account-job", status: "queued" }); });
  await waitFor(() => expect(mockJobCancel).toHaveBeenCalledWith("previous-account-job"));
  expect(screen.queryByLabelText("Title")).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Preview recipe" })).toBeEnabled();
});
