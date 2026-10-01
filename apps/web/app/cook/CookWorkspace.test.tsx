import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Recipe, CookingDish, CookingSession, CookingStep } from "@cooking/shared";
import { CookWorkspace } from "./CookWorkspace";
import type { CookingSessionController } from "./useCookingSession";

const { mockRecipesList, mockUseT } = vi.hoisted(() => ({
  mockRecipesList: vi.fn(),
  mockUseT: vi.fn(),
}));
vi.mock("../lib/api", () => ({ webApiClient: { recipes: {
      page: async (options: {q?: string} = {}) => ({items: (await mockRecipesList()).filter((r: Recipe) => !options.q || r.title.toLowerCase().includes(options.q.toLowerCase())).map((r: Recipe) => ({...r, ingredient_count:r.ingredients.length, step_count:r.steps?.length ?? 0, already_saved:true})), next_cursor:null}),
      get: async (id: string) => (await mockRecipesList()).find((r: Recipe) => r.id === id),
    } } }));
vi.mock("../lib/i18n", () => ({ useT: mockUseT, useI18n: () => ({ language: "en" }) }));

const messages: Record<string, string> = {
  "cook.navigation.positionProgress": "{progress}% of steps",
  "cook.navigation.endSession": "End session",
  "cook.navigation.viewing": "Viewing",
  "cook.navigation.stopTimer": "Stop timer",
  "cook.navigation.returnTimer": "Back to timer",
  "cook.navigation.previous": "Previous step",
  "cook.navigation.previousCompact": "Previous",
  "cook.navigation.next": "Next step",
  "cook.navigation.finishDish": "Finish dish",
  "cook.navigation.upNext": "Up next",
  "cook.navigation.overview": "Overview",
  "cook.navigation.closeOverview": "Close overview",
  "cook.navigation.overviewLabel": "Recipe overview for {dish}",
  "cook.navigation.viewStep": "View step {number}: {text}",
  "cook.navigation.done": "Done",
  "cook.navigation.current": "Cooking now",
  "cook.navigation.upcoming": "Coming up",
  "cook.navigation.returnCurrent": "Back to current step",
  "cook.view.label": "Cooking view",
  "cook.view.focused": "Focused",
  "cook.view.allDishes": "All dishes",
  "cook.view.focusDish": "Focus",
  "cook.preferences": "Cooking preferences",
  "cook.dish.complete": "This dish is complete.",
  "cook.action.reopen": "Undo last step",
  "cook.alerts.otherDevice": "Another device currently owns this timer's alert.",
  "cook.alerts.takeOver": "Take over alerts",
  "cook.active.eyebrow": "Cooking now",
  "cook.active.title": "Your cooking session",
  "cook.action.complete": "Complete step",
  "cook.action.extend": "+1 minute",
  "cook.action.pause": "Pause timer",
  "cook.action.resume": "Resume timer",
  "cook.action.skip": "Skip step",
  "cook.action.startTimer": "Start timer",
  "cook.action.undo": "Undo",
  "cook.undo.available": "Step updated. Undo is available for 10 seconds.",
  "cook.control.addDish": "Add dish",
  "cook.control.discard": "Discard session",
  "cook.control.finish": "Finish session",
  "cook.control.removeDish": "Remove {dish}",
  "cook.alerts.sound": "Play a timer sound",
  "cook.alerts.vibration": "Vibrate for timer attention",
  "cook.alerts.browserOpen": "Keep this browser open for cooking sounds and notifications.",
  "cook.add.title": "Add dishes",
  "cook.add.confirm": "Add selected dishes",
  "cook.attention.handsOn": "Hands on",
  "cook.attention.needsAttention": "Needs attention",
  "cook.attention.passive": "Passive",
  "cook.dish.focus": "Focus {dish}",
  "cook.progress": "{progress}% complete",
  "cook.recommendation.checkNow": "Check {dish} now",
  "cook.recommendation.ready": "Work on {dish}",
  "cook.recommendation.timerRunning": "{dish} timer is running",
  "cook.recommendations.title": "What to do next",
  "cook.step.number": "Step {current} of {total}",
  "recipe.tutorial.duration.aboutMinutes": "About {minutes} min",
  "recipe.tutorial.source.stated": "From recipe",
  "recipe.tutorial.attention.handsOn": "Hands-on",
  "recipe.tutorial.attention.passive": "Passive",
};

function step(overrides: Partial<CookingStep> = {}): CookingStep {
  return {
    id: "step-tofu",
    recipe_step_id: "recipe-step-tofu",
    position: 0,
    text: "Chop the tofu",
    duration_seconds: 120,
    duration_source: "stated",
    attention_type: "hands_on",
    action_type: "chop",
    image_url: null,
    state: "ready",
    timer_started_at: null,
    timer_ends_at: null,
    paused_remaining_seconds: null,
    resolved_at: null,
    notification_owner_device_id: null,
    revision: 2,
    updated_at: "2026-08-27T11:00:00.000Z",
    ...overrides,
  };
}

function dish(id: string, title: string, cookingStep: CookingStep): CookingDish {
  return {
    id,
    recipe_id: `recipe-${id}`,
    position: id === "tofu" ? 0 : 1,
    title,
    thumbnail_url: null,
    ingredients: [],
    equipment: [],
    tips: [],
    created_at: "2026-08-27T11:00:00.000Z",
    steps: [cookingStep],
  };
}

function controller(overrides: Partial<CookingSessionController> = {}): CookingSessionController {
  const session: CookingSession = {
    id: "session-1",
    version: 1,
    created_at: "2026-08-27T11:00:00.000Z",
    updated_at: "2026-08-27T11:00:00.000Z",
    dishes: [
      dish("tofu", "Mapo tofu", step()),
      dish(
        "rice",
        "Steamed rice",
        step({
          id: "step-rice",
          recipe_step_id: "recipe-step-rice",
          text: "Steam the rice",
          attention_type: "passive",
          action_type: "simmer",
          duration_seconds: 900,
        }),
      ),
    ],
  };
  return {
    status: "ready",
    session,
    error: null,
    actionError: null,
    sessionBusy: false,
    pendingCount: 0,
    notice: null,
    deviceId: "device-a",
    preferences: { notifications: false, sound: true, vibration: true, keep_awake: true },
    selectedDishId: "tofu",
    refresh: vi.fn(),
    acceptSession: vi.fn(),
    focusDish: vi.fn(),
    applyAction: vi.fn(),
    addDishes: vi.fn(),
    removeDish: vi.fn(),
    finishSession: vi.fn(),
    discardSession: vi.fn(),
    replayQueue: vi.fn(),
    updatePreferences: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseT.mockReturnValue((key: string, vars?: Record<string, string | number>) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? "")),
  );
  mockRecipesList.mockResolvedValue([
    { id: "recipe-soup", title: "Miso soup", ingredients: [], steps: [{ id: "soup-step", text: "Simmer", duration_seconds: 60 }] },
  ]);
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("can enter a cooking workspace after setup without changing hook order", () => {
  const { rerender } = render(<CookWorkspace controller={controller({ session: null })} />);
  expect(screen.queryByText("Your cooking session")).not.toBeInTheDocument();

  rerender(<CookWorkspace controller={controller()} />);
  expect(screen.getByText("Your cooking session")).toBeVisible();
});

test("shows hands-on work without a countdown or inferred completion", async () => {
  const current = controller();
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);

  expect(screen.getByRole("heading", { name: "Chop the tofu" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Focus Mapo tofu" })).toBeVisible();
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  expect(screen.getByText("About 2 min · From recipe · Hands-on")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
  expect(current.applyAction).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
});

test("keeps every dish visible in stable order and switches focus", async () => {
  const current = controller();
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);

  expect(screen.getAllByTestId("dish-rail-item").map((item) => item.textContent)).toEqual([
    expect.stringContaining("Mapo tofu"),
    expect.stringContaining("Steamed rice"),
  ]);
  await user.click(screen.getByRole("button", { name: "Focus Steamed rice" }));

  expect(current.focusDish).toHaveBeenCalledWith("rice");
});

test("starts a passive timer and keeps navigation separate", async () => {
  const current = controller({ selectedDishId: "rice" });
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);

  await user.click(screen.getByRole("button", { name: "Start timer" }));
  expect(current.applyAction).toHaveBeenCalledWith("rice", "step-rice", "start_timer");
  expect(screen.getByRole("button", { name: "Next step" })).toBeVisible();
});

test("shows an expired passive step as needing attention and can extend it", async () => {
  const needsAttention = step({
    id: "step-rice",
    recipe_step_id: "recipe-step-rice",
    text: "Steam the rice",
    attention_type: "passive",
    action_type: "simmer",
    state: "needs_attention",
    timer_started_at: "2026-08-27T10:45:00.000Z",
    timer_ends_at: "2026-08-27T11:00:00.000Z",
  });
  const current = controller({
    selectedDishId: "rice",
    session: {
      ...controller().session!,
      dishes: [dish("tofu", "Mapo tofu", step()), dish("rice", "Steamed rice", needsAttention)],
    },
  });
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);

  const focus = screen.getByTestId("focused-step");
  expect(within(focus).getByRole("timer", { name: "Needs attention 0:00" })).toBeVisible();
  await user.click(within(focus).getByRole("button", { name: "+1 minute" }));

  expect(current.applyAction).toHaveBeenCalledWith("rice", "step-rice", "extend_timer", 60);
});

test("adds, removes and ends cooking through explicit session controls", async () => {
  const current = controller();
  const user = userEvent.setup();
  const { rerender } = render(<CookWorkspace controller={current} />);

  await user.click(screen.getByRole("checkbox", { name: "Play a timer sound" }));
  expect(current.updatePreferences).toHaveBeenCalledWith({ sound: false });

  await user.click(screen.getByRole("button", { name: "Add dish" }));
  await user.click(await screen.findByRole("checkbox", { name: "Miso soup" }));
  await user.click(screen.getByRole("button", { name: "Add selected dishes" }));
  expect(current.addDishes).toHaveBeenCalledWith(["recipe-soup"]);

  await user.click(screen.getByRole("button", { name: "Remove Mapo tofu" }));
  expect(current.removeDish).toHaveBeenCalledWith("tofu");
  await user.click(screen.getByRole("button", { name: "End session" }));
  expect(current.discardSession).toHaveBeenCalledTimes(1);

  expect(screen.queryByRole("button", { name: "Finish session" })).not.toBeInTheDocument();
});

test("preserves the instruction heading and falls back to the recipe photo in focused view", () => {
  const current = controller();
  current.session!.dishes[0].thumbnail_url = "/recipe-photo.jpg";
  current.session!.dishes[0].steps[0].image_url = "/step-photo.jpg";
  render(<CookWorkspace controller={current} />);
  const focus = screen.getByTestId("focused-step");

  expect(within(focus).getByRole("heading", { name: "Chop the tofu" })).toBeVisible();
  const photo = focus.querySelector("img")!;
  expect(photo).toHaveAttribute("src", "/step-photo.jpg");
  fireEvent.error(photo);
  expect(focus.querySelector("img")).toHaveAttribute("src", "/recipe-photo.jpg");
});


test("keeps cooking preferences in an expandable panel", async () => {
  const user = userEvent.setup();
  render(<CookWorkspace controller={controller()} />);
  expect(screen.getByRole("checkbox", { name: "Play a timer sound" })).not.toBeVisible();
  await user.click(screen.getByText("Cooking preferences"));
  expect(screen.getByRole("checkbox", { name: "Play a timer sound" })).toBeVisible();
});


test("uses the dish photo in compact view and falls back to the step image when it fails", async () => {
  const current = controller();
  current.session!.dishes[0].thumbnail_url = "/recipe-photo.jpg";
  current.session!.dishes[0].steps[0].image_url = "/step-photo.jpg";
  render(<CookWorkspace controller={current} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "All dishes" }));
  const card = screen.getByRole("region", { name: "Mapo tofu" });
  const photo = card.querySelector("img")!;
  expect(photo).toHaveAttribute("src", "/recipe-photo.jpg");
  fireEvent.error(photo);
  expect(card.querySelector("img")).toHaveAttribute("src", "/step-photo.jpg");
  fireEvent.error(card.querySelector("img")!);
  expect(card.querySelector("img")).toBeNull();
  expect(within(card).getByText("Chop the tofu")).toBeVisible();
  expect(within(card).getByRole("button", { name: "Next step" })).toBeVisible();
});


test("switches between one focused instruction and all dishes without changing progress", async () => {
  const current = controller();
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);

  expect(screen.getByRole("button", { name: "Focused" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("Steam the rice")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "All dishes" }));

  expect(screen.getByRole("button", { name: "All dishes" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Chop the tofu")).toBeVisible();
  expect(screen.getByText("Steam the rice")).toBeVisible();
  expect(screen.getAllByTestId("stacked-step").map((card) => card.textContent)).toEqual([
    expect.stringContaining("Mapo tofu"),
    expect.stringContaining("Steamed rice"),
  ]);
  await user.click(screen.getByRole("button", { name: "Focused" }));
  expect(screen.getByText("Chop the tofu")).toBeVisible();
  expect(screen.queryByText("Steam the rice")).not.toBeInTheDocument();
  expect(current.applyAction).not.toHaveBeenCalled();
});


test("routes stacked timer and next controls to the dish they belong to", async () => {
  const current = controller();
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);
  await user.click(screen.getByRole("button", { name: "All dishes" }));
  const rice = screen.getByRole("region", { name: "Steamed rice" });

  await user.click(within(rice).getByRole("button", { name: "Start timer" }));
  expect(current.applyAction).toHaveBeenLastCalledWith("rice", "step-rice", "start_timer");
  expect(within(rice).getByRole("button", { name: "Next step" })).toBeDisabled();
  expect(current.applyAction).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
});


test("opens a chosen dish in focused view from its stacked card", async () => {
  const current = controller();
  const user = userEvent.setup();
  const { rerender } = render(<CookWorkspace controller={current} />);
  await user.click(screen.getByRole("button", { name: "All dishes" }));
  await user.click(screen.getByRole("button", { name: "Focus Steamed rice" }));
  expect(current.focusDish).toHaveBeenCalledWith("rice");
  rerender(<CookWorkspace controller={{ ...current, selectedDishId: "rice" }} />);

  expect(screen.getByRole("button", { name: "Focused" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("focused-step")).toHaveTextContent("Steam the rice");
});


test("keeps completed dishes and other-device timer controls available in all dishes view", async () => {
  const current = controller({
    session: {
      ...controller().session!,
      dishes: [
        dish("tofu", "Mapo tofu", step({ state: "completed" })),
        dish("rice", "Steamed rice", step({
          id: "step-rice",
          attention_type: "passive",
          state: "timer_paused",
          paused_remaining_seconds: 300,
          notification_owner_device_id: "device-b",
        })),
      ],
    },
  });
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);
  await user.click(screen.getByRole("button", { name: "All dishes" }));

  const tofu = screen.getByRole("region", { name: "Mapo tofu" });
  const rice = screen.getByRole("region", { name: "Steamed rice" });
  expect(within(tofu).queryByText("This dish is complete.")).not.toBeInTheDocument();
  expect(within(rice).getByRole("timer")).toHaveTextContent("5:00");
  expect(within(tofu).getByRole("button", { name: "Next step" })).toBeDisabled();
  await user.click(within(tofu).getByRole("button", { name: "Overview" }));
  expect(within(tofu).getByRole("region", { name: "Recipe overview for Mapo tofu" })).toBeVisible();
  expect(current.applyAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Take over alerts" }));
  expect(current.applyAction).toHaveBeenLastCalledWith("rice", "step-rice", "take_alert_ownership");
});


test("shares the reading position with the dish rail and both views without mutating cooking steps", async () => {
  const current=controller();
  current.session!.dishes[0].steps.push(step({id:"step-two",recipe_step_id:"recipe-step-two",position:1,text:"Mix the sauce",state:"locked"}));
  const user=userEvent.setup();
  render(<CookWorkspace controller={current} />);
  await user.click(screen.getByRole("button",{name:"Next step",exact:true}));
  expect(screen.getByText("Mix the sauce",{exact:true})).toBeVisible();
  expect(within(screen.getAllByTestId("dish-rail-item")[0]).getByText("100%")).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"All dishes",exact:true}));
  const tofu=screen.getByRole("region",{name:"Mapo tofu",exact:true});
  expect(within(tofu).getByText("Mix the sauce",{exact:true})).toBeVisible();
  await user.click(within(tofu).getByRole("button",{name:"Previous step",exact:true}));
  await user.click(screen.getByRole("button",{name:"Focused",exact:true}));
  expect(screen.getByText("Chop the tofu",{exact:true})).toBeVisible();
  expect(within(screen.getAllByTestId("dish-rail-item")[0]).getByText("50%")).toBeInTheDocument();
  expect(current.applyAction).not.toHaveBeenCalled();
});
