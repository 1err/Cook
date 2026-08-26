import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  "common.added": "Added",
  "common.loading": "Loading...",
  "common.next": "Next",
  "common.previous": "Previous",
  "nav.shoppingList": "Shopping List",
  "planner.addAnotherRecipe": "Add another recipe",
  "planner.addAnotherRecipeForSlot": "Add another recipe for {slot} on {date}",
  "planner.addRecipe": "Add recipe",
  "planner.addToSlot": "Add to {slot}",
  "planner.chooseRecipe": "Choose recipe",
  "planner.chooseRecipeForMealSlot": "Choose recipe for meal slot",
  "planner.chooseRecipeForSlot": "Choose a recipe for {slot} on {date}",
  "planner.clearFilter": "Clear filter",
  "planner.closeRecipePicker": "Close recipe picker",
  "planner.filterAria": "Filter planner recipes by tag",
  "planner.importRecipes": "Import recipes",
  "planner.loadFailed": "Could not load this week's saved plan. Planner changes are disabled to protect existing meals.",
  "planner.mealBreakfast": "breakfast",
  "planner.mealLunch": "lunch",
  "planner.mealDinner": "dinner",
  "planner.manageRecipeSlot": "Manage recipes for meal slot",
  "planner.noRecipesMatch": "No recipes match the current search or filter.",
  "planner.openRecipe": "Open {title} for {slot} on {date}",
  "planner.plannedForSlot": "Planned for {slot}",
  "planner.removeRecipeFromSlot": "Remove {title} from {slot} on {date}",
  "planner.phoneFriendlyDesc": "Tap any meal slot to choose from your saved recipes.",
  "planner.phoneFriendlyTitle": "Phone-friendly planning",
  "planner.planYourWeek": "to plan your week.",
  "planner.savedRecipes": "Recipe Library",
  "planner.savedRecipesDesc": "Drag recipes into your week.",
  "planner.saveFailed": "Could not save your planner change. Your previous plan was restored.",
  "planner.retryLoad": "Retry loading plan",
  "planner.searchAria": "Search recipes for planner",
  "planner.searchLibrary": "Search library...",
  "planner.shoppingListUsesPlan": "Shopping list uses this week's plan.",
  "planner.sortedAZ": "Sorted A-Z",
  "planner.title": "Weekly planner",
  "planner.viewAllRecipes": "View all {count}",
  "planner.viewAllRecipesForSlot": "View all {count} planned recipes for {slot} on {date}",
  "recipe.ingredientsCount": "{count} ingredients",
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

async function addDinnerRecipe(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  date = "2026-08-10",
) {
  await user.click(
    await screen.findByRole("button", {
      name: new RegExp(`^(Choose a recipe|Add another recipe) for dinner on ${date}$`),
    }),
  );
  const picker = await screen.findByRole("dialog", { name: "Choose recipe for meal slot" });
  const recipeCard = within(picker).getByText(title).closest(".planner-source-card");
  expect(recipeCard).not.toBeNull();
  await user.click(
    within(recipeCard as HTMLElement).getByRole("button", { name: `Add ${title}` }),
  );
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

test("omits the sidebar New recipe footer action", async () => {
  render(<PlannerPage />);

  await screen.findByRole("heading", { name: "Weekly planner" });
  expect(screen.queryByRole("link", { name: /New recipe/ })).not.toBeInTheDocument();
  expect(document.querySelector(".planner-editorial__sidebar-foot")).not.toBeInTheDocument();
});

test("keeps Add actions and recipe media in the open recipe picker, not the recipe rail", async () => {
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") {
      return Promise.resolve(
        jsonResponse([
          {
            id: "recipe-1",
            title: "Recipe with a thumbnail",
            thumbnail_url: "https://images.example.test/recipe.jpg",
            ingredients: [],
          },
          { id: "recipe-2", title: "Recipe with a placeholder", ingredients: [] },
        ]),
      );
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);

  await user.click(
    await screen.findByRole("button", {
      name: "Choose a recipe for dinner on 2026-08-10",
    }),
  );
  const dialog = await screen.findByRole("dialog", { name: /Choose recipe/ });

  expect(within(dialog).getAllByRole("button", { name: /^Add Recipe/ })).toHaveLength(2);
  expect(within(dialog).getByRole("button", { name: "Add Recipe with a thumbnail" })).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Add Recipe with a placeholder" })).toBeVisible();
  expect(within(screen.getByRole("complementary")).queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
  expect(within(dialog).getAllByRole("img", { hidden: true }).length).toBeGreaterThan(0);
  expect(within(dialog).getAllByText("0 ingredients")).toHaveLength(2);
});

test("marks recipes already planned in the selected slot as added", async () => {
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/meal-plan?")) {
      return Promise.resolve(jsonResponse([
        { date: "2026-08-10", breakfast: [], lunch: [], dinner: ["recipe-1"] },
      ]));
    }
    if (path === "/recipes") {
      return Promise.resolve(jsonResponse([
        { id: "recipe-1", title: "Test recipe", ingredients: [] },
        { id: "recipe-2", title: "Second recipe", ingredients: [] },
      ]));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);

  await user.click(await screen.findByRole("button", {
    name: "Add another recipe for dinner on 2026-08-10",
  }));
  const picker = await screen.findByRole("dialog", { name: "Choose recipe for meal slot" });

  expect(within(picker).getByRole("button", { name: "Added Test recipe" })).toBeDisabled();
  expect(within(picker).getByRole("button", { name: "Add Second recipe" })).toBeEnabled();
});

test("lists every overflow recipe and removes any chosen recipe from the manager", async () => {
  const dinner = ["recipe-1", "recipe-2", "recipe-3", "recipe-4", "recipe-5"];
  const recipes = dinner.map((id, index) => ({
    id,
    title: ["First", "Second", "Third", "Fourth", "Fifth"][index] + " recipe",
    ingredients: [],
  }));
  const requests: Array<{ dinner: string[] }> = [];
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?")) {
      return Promise.resolve(jsonResponse([
        { date: "2026-08-10", breakfast: [], lunch: [], dinner },
      ]));
    }
    if (path === "/recipes") return Promise.resolve(jsonResponse(recipes));
    if (path === "/meal-plan/2026-08-10" && options?.method === "PUT") {
      const slots = JSON.parse(String(options.body));
      requests.push(slots);
      return Promise.resolve(jsonResponse({ date: "2026-08-10", ...slots }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);

  await user.click(await screen.findByRole("button", {
    name: "View all 5 planned recipes for dinner on 2026-08-10",
  }));
  let manager = await screen.findByRole("dialog", { name: "Manage recipes for meal slot" });
  for (const recipe of recipes) {
    expect(within(manager).getByText(recipe.title)).toBeVisible();
  }

  await user.click(within(manager).getByRole("button", {
    name: "Remove Fourth recipe from dinner on 2026-08-10",
  }));
  await waitFor(() => {
    expect(requests.at(-1)?.dinner).toEqual(["recipe-1", "recipe-2", "recipe-3", "recipe-5"]);
    expect(within(manager).queryByText("Fourth recipe")).not.toBeInTheDocument();
  });

  await user.click(within(manager).getByRole("button", { name: "Add recipe" }));
  manager = await screen.findByRole("dialog", { name: "Choose recipe for meal slot" });
  expect(within(manager).getByRole("button", { name: "Added First recipe" })).toBeDisabled();
});

test("contains picker focus and restores it after Escape, Close, and backdrop dismissal", async () => {
  const user = userEvent.setup();
  render(<PlannerPage />);
  const trigger = await screen.findByRole("button", {
    name: "Choose a recipe for dinner on 2026-08-10",
  });

  await user.click(trigger);
  let dialog = await screen.findByRole("dialog", { name: /Choose recipe/ });
  let close = within(dialog).getAllByRole("button", { name: "Close recipe picker" })[1];
  await waitFor(() => expect(close).toHaveFocus());
  await user.tab({ shift: true });
  expect(within(dialog).getByRole("button", { name: "Add Test recipe" })).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /Choose recipe/ })).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  dialog = await screen.findByRole("dialog", { name: /Choose recipe/ });
  close = within(dialog).getAllByRole("button", { name: "Close recipe picker" })[1];
  await user.click(close);
  await waitFor(() => expect(trigger).toHaveFocus());

  await user.click(trigger);
  dialog = await screen.findByRole("dialog", { name: /Choose recipe/ });
  await user.click(dialog.querySelector(".planner-mobile-picker__backdrop") as HTMLButtonElement);
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("restores picker focus to the meal-slot fallback when selection replaces its trigger", async () => {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") {
      return Promise.resolve(
        jsonResponse([{ id: "recipe-1", title: "Test recipe", ingredients: [] }]),
      );
    }
    if (path === "/meal-plan/2026-08-10" && options?.method === "PUT") {
      const slots = JSON.parse(String(options.body));
      return Promise.resolve(jsonResponse({ date: "2026-08-10", ...slots }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);
  const trigger = await screen.findByRole("button", {
    name: "Choose a recipe for dinner on 2026-08-10",
  });

  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: /Choose recipe/ });
  await user.click(within(dialog).getByRole("button", { name: "Add Test recipe" }));

  const slot = screen.getAllByTestId("planner-meal-slot").find(
    (candidate) => candidate.dataset.date === "2026-08-10" && candidate.dataset.slotIndex === "2",
  );
  expect(slot).toBeDefined();
  await waitFor(() => expect(slot).toHaveFocus());
  expect(slot).toHaveAttribute("tabindex", "-1");
  expect(trigger).not.toBeInTheDocument();
});

test("restores the prior plan and reports an error when an optimistic meal-plan write fails", async () => {
  const failedWrite = deferredResponse();
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?")) return Promise.resolve(jsonResponse([]));
    if (path === "/recipes") {
      return Promise.resolve(jsonResponse([{ id: "recipe-1", title: "Test recipe", ingredients: [] }]));
    }
    if (path === "/meal-plan/2026-08-10" && options?.method === "PUT") {
      return failedWrite.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);

  await user.click(
    await screen.findByRole("button", {
      name: "Choose a recipe for dinner on 2026-08-10",
    }),
  );
  const picker = await screen.findByRole("dialog", { name: "Choose recipe for meal slot" });
  await user.click(within(picker).getByRole("button", { name: "Add Test recipe" }));

  expect(
    await screen.findByRole("button", {
      name: /Open Test recipe/,
    }),
  ).toBeVisible();
  failedWrite.resolve(jsonResponse({ detail: "save failed" }, 500));

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

test("settles writes for separate dates independently when the earlier date later fails", async () => {
  const dateA = deferredResponse();
  const dateB = deferredResponse();
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
    if (path.startsWith("/meal-plan/") && options?.method === "PUT") {
      requests.push({
        date: path.slice("/meal-plan/".length),
        slots: JSON.parse(String(options.body)),
      });
      return path.endsWith("2026-08-10") ? dateA.promise : dateB.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);

  await addDinnerRecipe(user, "First recipe", "2026-08-10");
  await addDinnerRecipe(user, "Second recipe", "2026-08-11");

  expect(requests).toEqual([
    { date: "2026-08-10", slots: { breakfast: [], lunch: [], dinner: ["recipe-1"] } },
    { date: "2026-08-11", slots: { breakfast: [], lunch: [], dinner: ["recipe-2"] } },
  ]);
  dateB.resolve(mealPlanResponse("2026-08-11", ["recipe-2"]));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Open Second recipe.*2026-08-11/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Open First recipe.*2026-08-10/ })).toBeVisible();
  });

  dateA.resolve(jsonResponse({ detail: "date A failed" }, 500));
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /Open First recipe.*2026-08-10/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Second recipe.*2026-08-11/ })).toBeVisible();
  });
});

test("blocks mutations after a failed plan read until retry restores authoritative state", async () => {
  let planReadCount = 0;
  const requests: Array<{ date: string; slots: { breakfast: string[]; lunch: string[]; dinner: string[] } }> = [];
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path.startsWith("/meal-plan?")) {
      planReadCount += 1;
      return Promise.resolve(
        planReadCount === 1
          ? jsonResponse({ detail: "read failed" }, 500)
          : jsonResponse([{ date: "2026-08-10", breakfast: [], lunch: [], dinner: ["recipe-2"] }]),
      );
    }
    if (path === "/recipes") {
      return Promise.resolve(
        jsonResponse([
          { id: "recipe-1", title: "First recipe", ingredients: [] },
          { id: "recipe-2", title: "Persisted recipe", ingredients: [] },
        ]),
      );
    }
    if (path === "/meal-plan/2026-08-10" && options?.method === "PUT") {
      const slots = JSON.parse(String(options.body));
      requests.push({ date: "2026-08-10", slots });
      return Promise.resolve(jsonResponse({ date: "2026-08-10", ...slots }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);

  const choose = await screen.findByRole("button", {
    name: "Choose a recipe for dinner on 2026-08-10",
  });
  expect(choose).toBeDisabled();
  await user.click(choose);
  const dinnerSlot = screen.getAllByTestId("planner-meal-slot").find(
    (slot) => slot.dataset.date === "2026-08-10" && slot.dataset.slotIndex === "2",
  );
  expect(dinnerSlot).toBeDefined();
  fireEvent.drop(dinnerSlot as HTMLElement, {
    dataTransfer: { getData: () => "recipe-1" },
  });
  expect(requests).toEqual([]);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Could not load this week's saved plan. Planner changes are disabled to protect existing meals.",
  );

  await user.click(screen.getByRole("button", { name: "Retry loading plan" }));
  expect(
    await screen.findByRole("button", { name: /Open Persisted recipe.*2026-08-10/ }),
  ).toBeVisible();
  await addDinnerRecipe(user, "First recipe", "2026-08-10");

  await waitFor(() => {
    expect(requests).toEqual([
      {
        date: "2026-08-10",
        slots: { breakfast: [], lunch: [], dinner: ["recipe-2", "recipe-1"] },
      },
    ]);
  });
});

test("offers the same protected retry when the plan request rejects", async () => {
  let planReadCount = 0;
  mockApiFetch.mockImplementation((path: string) => {
    if (path.startsWith("/meal-plan?")) {
      planReadCount += 1;
      return planReadCount === 1
        ? Promise.reject(new Error("network unavailable"))
        : Promise.resolve(jsonResponse([]));
    }
    if (path === "/recipes") {
      return Promise.resolve(jsonResponse([{ id: "recipe-1", title: "First recipe", ingredients: [] }]));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const user = userEvent.setup();
  render(<PlannerPage />);

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Could not load this week's saved plan. Planner changes are disabled to protect existing meals.",
  );
  expect(
    screen.getByRole("button", { name: "Choose a recipe for dinner on 2026-08-10" }),
  ).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Retry loading plan" }));
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Choose a recipe for dinner on 2026-08-10" }),
    ).toBeEnabled();
  });
});
