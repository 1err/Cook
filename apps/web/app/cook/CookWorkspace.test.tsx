import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CookingDish, CookingSession, CookingStep } from "@cooking/shared";
import { CookWorkspace } from "./CookWorkspace";
import type { CookingSessionController } from "./useCookingSession";

const { mockRecipesList, mockUseT } = vi.hoisted(() => ({
  mockRecipesList: vi.fn(),
  mockUseT: vi.fn(),
}));
vi.mock("../lib/api", () => ({ webApiClient: { recipes: { list: mockRecipesList } } }));
vi.mock("../lib/i18n", () => ({ useT: mockUseT }));

const messages: Record<string, string> = {
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

test("shows hands-on work without a countdown and advances explicitly", async () => {
  const current = controller();
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);

  expect(screen.getByRole("heading", { name: "Mapo tofu" })).toBeVisible();
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  expect(screen.getByText("About 2 min · From recipe · Hands-on")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Complete step" }));

  expect(current.applyAction).toHaveBeenCalledWith("tofu", "step-tofu", "complete");
  expect(screen.getByText("Step updated. Undo is available for 10 seconds.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current.applyAction).toHaveBeenLastCalledWith("tofu", "step-tofu", "reopen");
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

test("starts a passive timer but still offers explicit completion", async () => {
  const current = controller({ selectedDishId: "rice" });
  const user = userEvent.setup();
  render(<CookWorkspace controller={current} />);

  await user.click(screen.getByRole("button", { name: "Start timer" }));
  expect(current.applyAction).toHaveBeenCalledWith("rice", "step-rice", "start_timer");
  expect(screen.getByRole("button", { name: "Complete step" })).toBeVisible();
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

test("adds, removes, finishes, and discards through explicit session controls", async () => {
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
  await user.click(screen.getByRole("button", { name: "Discard session" }));
  expect(current.discardSession).toHaveBeenCalledTimes(1);

  const done = step({ state: "completed", resolved_at: "2026-08-27T11:02:00.000Z" });
  const completeController = controller({
    session: { ...current.session!, dishes: [dish("tofu", "Mapo tofu", done)] },
  });
  rerender(<CookWorkspace controller={completeController} />);
  await user.click(screen.getByRole("button", { name: "Finish session" }));
  expect(completeController.finishSession).toHaveBeenCalledTimes(1);
});
