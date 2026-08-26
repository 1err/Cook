import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@cooking/api-client";
import type { CookingSession, MealPlanDay, Recipe } from "@cooking/shared";
import { CookSetup } from "./CookSetup";

const { mockActive, mockCreate, mockDiscard, mockMealPlanList, mockRecipesList, mockUseT } =
  vi.hoisted(() => ({
    mockActive: vi.fn(),
    mockCreate: vi.fn(),
    mockDiscard: vi.fn(),
    mockMealPlanList: vi.fn(),
    mockRecipesList: vi.fn(),
    mockUseT: vi.fn(),
  }));

vi.mock("../lib/api", () => ({
  webApiClient: {
    cooking: { active: mockActive, create: mockCreate, discard: mockDiscard },
    mealPlan: { list: mockMealPlanList },
    recipes: { list: mockRecipesList },
  },
}));
vi.mock("../lib/i18n", () => ({ useT: mockUseT }));

const messages: Record<string, string> = {
  "common.loading": "Loading...",
  "common.search": "Search",
  "cook.conflict.discard": "Discard old session",
  "cook.conflict.message": "Resume the active session or discard it before starting another.",
  "cook.conflict.resume": "Resume",
  "cook.conflict.title": "Cooking already in progress",
  "cook.empty.description": "Choose a planned meal or recipes from your library.",
  "cook.empty.title": "Start cooking",
  "cook.setup.breakfast": "Breakfast",
  "cook.setup.chooseRecipes": "Choose recipes",
  "cook.setup.dinner": "Dinner",
  "cook.setup.editTutorial": "Edit tutorial",
  "cook.setup.lunch": "Lunch",
  "cook.setup.noPlannedRecipes": "No recipes are saved in this meal.",
  "cook.setup.plannedMeal": "Planned meal",
  "cook.setup.startCount": "Start {count} dishes",
};

const recipes: Recipe[] = [
  {
    id: "tofu",
    title: "Mapo tofu",
    ingredients: [],
    steps: [{ id: "step-tofu", text: "Cook tofu", duration_seconds: 300 }],
  },
  {
    id: "rice",
    title: "Steamed rice",
    ingredients: [],
    steps: [{ id: "step-rice", text: "Steam rice", duration_seconds: 900 }],
  },
  { id: "draft", title: "Unfinished soup", ingredients: [], steps: [] },
];
const plans: MealPlanDay[] = [
  { date: "2026-08-27", breakfast: [], lunch: [], dinner: ["tofu", "rice"] },
];
const created: CookingSession = {
  id: "session-new",
  version: 1,
  created_at: "2026-08-27T12:00:00.000Z",
  updated_at: "2026-08-27T12:00:00.000Z",
  dishes: [],
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
  mockUseT.mockReturnValue((key: string, vars?: Record<string, string | number>) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? "")),
  );
  mockRecipesList.mockResolvedValue(recipes);
  mockMealPlanList.mockResolvedValue(plans);
  mockCreate.mockResolvedValue(created);
  mockActive.mockResolvedValue(created);
  mockDiscard.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("starts all recipes from the selected planned meal", async () => {
  const onSessionCreated = vi.fn();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<CookSetup onSessionCreated={onSessionCreated} />);

  await user.click(await screen.findByRole("button", { name: "Dinner" }));
  const start = await screen.findByRole("button", { name: "Start 2 dishes" });
  await user.click(start);

  await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(created));
  expect(mockCreate).toHaveBeenCalledWith(["tofu", "rice"]);
});

test("switches to searchable manual selection and excludes recipes without tutorials", async () => {
  const onSessionCreated = vi.fn();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<CookSetup onSessionCreated={onSessionCreated} />);

  await user.click(await screen.findByRole("tab", { name: "Choose recipes" }));
  const list = screen.getByRole("group", { name: "Choose recipes" });
  await user.click(within(list).getByRole("checkbox", { name: "Mapo tofu" }));
  expect(within(list).queryByRole("checkbox", { name: "Unfinished soup" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Edit tutorial Unfinished soup" })).toHaveAttribute(
    "href",
    "/recipe/draft/tutorial/edit",
  );

  await user.click(screen.getByRole("button", { name: "Start 1 dishes" }));

  await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(created));
  expect(mockCreate).toHaveBeenCalledWith(["tofu"]);
});

test("offers resume and discard choices after an active-session conflict", async () => {
  mockCreate.mockRejectedValueOnce(
    new ApiError("A cooking session is already in progress.", 409, "active_session_exists"),
  );
  const onSessionCreated = vi.fn();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<CookSetup onSessionCreated={onSessionCreated} />);

  await user.click(await screen.findByRole("button", { name: "Dinner" }));
  await user.click(await screen.findByRole("button", { name: "Start 2 dishes" }));

  const dialog = await screen.findByRole("dialog", { name: "Cooking already in progress" });
  await user.click(within(dialog).getByRole("button", { name: "Resume" }));

  await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(created));
  expect(mockActive).toHaveBeenCalledTimes(1);
});
