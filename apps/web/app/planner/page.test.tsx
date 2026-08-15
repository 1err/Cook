import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import PlannerPage from "./page";

const { mockApiFetch, mockUseRouter, mockUseSearchParams, mockUseT } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockUseRouter: vi.fn(),
  mockUseSearchParams: vi.fn(),
  mockUseT: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: mockUseRouter,
  useSearchParams: mockUseSearchParams,
}));

vi.mock("../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../lib/i18n", () => ({ useT: mockUseT }));

const messages: Record<string, string> = {
  "common.add": "Add",
  "common.loading": "Loading...",
  "common.next": "Next",
  "common.previous": "Previous",
  "nav.shoppingList": "Shopping List",
  "planner.addAnotherRecipe": "Add another recipe",
  "planner.addAnotherRecipeForSlot": "Add another recipe for {slot} on {date}",
  "planner.addToSlot": "Add to {slot}",
  "planner.chooseRecipe": "Choose recipe",
  "planner.chooseRecipeForMealSlot": "Choose recipe for meal slot",
  "planner.chooseRecipeForSlot": "Choose a recipe for {slot} on {date}",
  "planner.clearFilter": "Clear filter",
  "planner.closeRecipePicker": "Close recipe picker",
  "planner.filterAria": "Filter planner recipes by tag",
  "planner.importRecipes": "Import recipes",
  "planner.newRecipe": "New recipe",
  "planner.noRecipesMatch": "No recipes match the current search or filter.",
  "planner.openRecipe": "Open {title} for {slot} on {date}",
  "planner.phoneFriendlyDesc": "Tap any meal slot to choose from your saved recipes.",
  "planner.phoneFriendlyTitle": "Phone-friendly planning",
  "planner.planYourWeek": "to plan your week.",
  "planner.savedRecipes": "Your saved recipes",
  "planner.savedRecipesDesc": "Drag recipes into your week.",
  "planner.saveFailed": "Could not save your planner change. Your previous plan was restored.",
  "planner.searchAria": "Search recipes for planner",
  "planner.searchLibrary": "Search library...",
  "planner.shoppingListUsesPlan": "Shopping list uses this week's plan.",
  "planner.sortedAZ": "Sorted A-Z",
  "planner.title": "Weekly planner",
};

function t(key: string, vars?: Record<string, string | number>) {
  const message = messages[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
};

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function mealPlanResponse(date: string, dinner: string[]) {
  return jsonResponse({ date, breakfast: [], lunch: [], dinner });
}

function mockDeferredPlannerWrites(putResponses: DeferredResponse[]) {
  const requests: Array<{ date: string; slots: { breakfast: string[]; lunch: string[]; dinner: string[] } }> = [];
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") {
      return Promise.resolve(
        jsonResponse([
          { id: "recipe-1", title: "First recipe", ingredients: [] },
          { id: "recipe-2", title: "Second recipe", ingredients: [] },
        ]),
      );
    }
    if (path === "/meal-plan/2026-08-10" && options?.method === "PUT") {
      requests.push({
        date: path.slice("/meal-plan/".length),
        slots: JSON.parse(String(options.body)),
      });
      const deferred = putResponses.shift();
      if (!deferred) throw new Error("Unexpected additional meal-plan PUT");
      return deferred.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  return requests;
}

async function addDinnerRecipe(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(
    await screen.findByRole("button", {
      name: /^(Choose a recipe|Add another recipe) for dinner on 2026-08-10$/,
    }),
  );
  const picker = await screen.findByRole("dialog", { name: "Choose recipe for meal slot" });
  const recipeCard = within(picker).getByText(title).closest(".planner-source-card");
  expect(recipeCard).not.toBeNull();
  await user.click(within(recipeCard as HTMLElement).getByRole("button", { name: "Add" }));
}

beforeEach(() => {
  mockUseRouter.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
  mockUseSearchParams.mockReturnValue(new URLSearchParams("week=2026-08-10"));
  mockUseT.mockReturnValue(t);
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") {
      return Promise.resolve(jsonResponse([{ id: "recipe-1", title: "Test recipe", ingredients: [] }]));
    }
    if (path === "/meal-plan/2026-08-10" && options?.method === "PUT") {
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse({ detail: "save failed" }, 500)), 250);
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(cleanup);

test("restores the prior plan and reports an error when an optimistic meal-plan write fails", async () => {
  const user = userEvent.setup();
  render(<PlannerPage />);

  await user.click(
    await screen.findByRole("button", {
      name: "Choose a recipe for dinner on 2026-08-10",
    }),
  );
  const picker = await screen.findByRole("dialog", { name: "Choose recipe for meal slot" });
  await user.click(within(picker).getByRole("button", { name: "Add" }));

  expect(
    await screen.findByRole("button", {
      name: /Open Test recipe/,
    }),
  ).toBeVisible();

  await waitFor(() => {
    expect(
      screen.queryByRole("button", {
        name: /Open Test recipe/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not save your planner change. Your previous plan was restored.",
    );
  });
});

test("serializes rapid same-date writes and rebases the next payload on the confirmed first write", async () => {
  const first = deferredResponse();
  const second = deferredResponse();
  const requests = mockDeferredPlannerWrites([first, second]);
  const user = userEvent.setup();
  render(<PlannerPage />);

  await addDinnerRecipe(user, "First recipe");
  await addDinnerRecipe(user, "Second recipe");

  expect(requests).toEqual([
    { date: "2026-08-10", slots: { breakfast: [], lunch: [], dinner: ["recipe-1"] } },
  ]);
  expect(await screen.findByRole("button", { name: /Open Second recipe/ })).toBeVisible();

  first.resolve(mealPlanResponse("2026-08-10", ["recipe-1"]));
  await waitFor(() => {
    expect(requests).toEqual([
      { date: "2026-08-10", slots: { breakfast: [], lunch: [], dinner: ["recipe-1"] } },
      { date: "2026-08-10", slots: { breakfast: [], lunch: [], dinner: ["recipe-1", "recipe-2"] } },
    ]);
  });
  second.resolve(mealPlanResponse("2026-08-10", ["recipe-1", "recipe-2"]));
});

test("removes every failed queued operation without leaving a phantom optimistic recipe", async () => {
  const first = deferredResponse();
  const second = deferredResponse();
  const requests = mockDeferredPlannerWrites([first, second]);
  const user = userEvent.setup();
  render(<PlannerPage />);

  await addDinnerRecipe(user, "First recipe");
  await addDinnerRecipe(user, "Second recipe");
  expect(await screen.findByRole("button", { name: /Open First recipe/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Open Second recipe/ })).toBeVisible();

  first.resolve(jsonResponse({ detail: "first save failed" }, 500));
  await waitFor(() => {
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({
      date: "2026-08-10",
      slots: { breakfast: [], lunch: [], dinner: ["recipe-2"] },
    });
    expect(screen.queryByRole("button", { name: /Open First recipe/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Second recipe/ })).toBeVisible();
  });
  second.resolve(jsonResponse({ detail: "second save failed" }, 500));

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /Open First recipe/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Second recipe/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not save your planner change. Your previous plan was restored.",
    );
  });
});

test("keeps a later queued recipe when the preceding write fails", async () => {
  const first = deferredResponse();
  const second = deferredResponse();
  const requests = mockDeferredPlannerWrites([first, second]);
  const user = userEvent.setup();
  render(<PlannerPage />);

  await addDinnerRecipe(user, "First recipe");
  await addDinnerRecipe(user, "Second recipe");
  first.resolve(jsonResponse({ detail: "first save failed" }, 500));

  await waitFor(() => {
    expect(requests).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Open First recipe/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Second recipe/ })).toBeVisible();
  });
  second.resolve(mealPlanResponse("2026-08-10", ["recipe-2"]));

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /Open First recipe/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Second recipe/ })).toBeVisible();
  });
});
