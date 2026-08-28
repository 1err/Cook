import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RecipeDetailPage from "./page";

const { mockActive, mockApiFetch, mockPush, translate } = vi.hoisted(() => ({
  mockActive: vi.fn(),
  mockApiFetch: vi.fn(),
  mockPush: vi.fn(),
  translate: (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "common.delete": "Delete",
      "common.edit": "Edit",
      "common.ingredients": "Ingredients",
      "common.moreActions": "More actions",
      "nav.library": "Library",
      "recipe.mealPlanner": "Meal planner",
      "recipe.originalVideo": "Original video",
      "recipe.steps": "Steps",
      "recipe.tutorial.edit": "Edit tutorial",
      "recipe.tutorial.duration.aboutMinutes": "About {minutes} min",
      "recipe.tutorial.source.estimated": "AI estimated",
      "recipe.tutorial.attention.passive": "Passive",
      "recipe.tutorial.action.simmer": "Simmer",
      "recipe.tutorial.illustrationLabel": "{action} illustration",
    };
    return (messages[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => String(vars?.[name] ?? ""),
    );
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "recipe-1" }),
  useRouter: () => ({ push: mockPush }),
}));
vi.mock("../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../lib/api", () => ({
  apiFetch: mockApiFetch,
  webApiClient: { cooking: { active: mockActive } },
}));
vi.mock("../../lib/i18n", () => ({ useT: () => translate }));

beforeEach(() => {
  mockActive.mockResolvedValue(null);
  mockApiFetch.mockReset().mockResolvedValue(new Response(JSON.stringify({
    id: "recipe-1",
    title: "Tomato noodles",
    source_url: "https://example.com/video",
    thumbnail_url: null,
    ingredients: [],
    steps: [{
      id: "d042d265-8ac1-46cf-9d26-0c459538b8bb",
      text: "Simmer the sauce.",
      duration_seconds: 480,
      duration_source: "estimated",
      attention_type: "passive",
      action_type: "simmer",
      image_url: null,
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
});

it("keeps destructive actions behind an explicit overflow control", async () => {
  const user = userEvent.setup();
  render(<RecipeDetailPage />);

  expect(await screen.findByRole("heading", { name: "Tomato noodles" })).toBeVisible();
  const disclosure = screen.getByLabelText("More actions");
  const menu = disclosure.closest("details");
  expect(menu).not.toHaveAttribute("open");
  expect(within(menu!).getByRole("button", { name: "Delete" })).toBeInTheDocument();

  await user.click(disclosure);
  expect(menu).toHaveAttribute("open");
});

afterEach(cleanup);

it("integrates the timed tutorial without losing existing recipe actions", async () => {
  render(<RecipeDetailPage />);

  expect(await screen.findByRole("heading", { name: "Tomato noodles" })).toBeVisible();
  expect(screen.getByText("About 8 min · AI estimated · Passive")).toBeVisible();
  expect(screen.getByRole("link", { name: "Edit tutorial" })).toHaveAttribute(
    "href",
    "/recipe/recipe-1/tutorial/edit",
  );
  expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/library/recipe-1");
  expect(screen.getByRole("link", { name: "Meal planner" })).toHaveAttribute("href", "/planner");
  expect(screen.getByRole("link", { name: /Original video/ })).toHaveAttribute(
    "href",
    "https://example.com/video",
  );
});
