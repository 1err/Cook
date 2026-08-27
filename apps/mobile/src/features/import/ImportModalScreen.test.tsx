import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { Recipe } from "@cooking/shared";
import { ImportModalScreen } from "./ImportModalScreen";

const parsedDraft: Recipe = {
  id: "draft",
  title: "Imported noodles",
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
const mockCreate = jest.fn();
const mockApiClient = {
  recipes: {
    parseLink: mockParseLink,
    parseTranscript: jest.fn(),
    create: mockCreate,
    uploadImage: jest.fn(),
  },
};

jest.mock("../../lib/api", () => ({
  useApiClient: () => mockApiClient,
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
  mockParseLink.mockResolvedValue(parsedDraft);
  mockCreate.mockResolvedValue({ ...parsedDraft, id: "saved-recipe" });
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
