import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { CookingDish, CookingSession, CookingStep } from "@cooking/shared";
import { CookWorkspace } from "./CookWorkspace";
import type { MobileCookingSessionController } from "./useCookingSession";

jest.mock("../../lib/api", () => ({
  useApiClient: () => ({ recipes: { list: jest.fn().mockResolvedValue([]) } }),
}));

const translate = (key: string, vars?: Record<string, string | number>) => {
  const messages: Record<string, string> = {
    "cook.active.title": "Your cooking session",
    "cook.action.complete": "Complete step",
    "cook.action.extend": "+1 minute",
    "cook.action.pause": "Pause timer",
    "cook.action.resume": "Resume timer",
    "cook.action.skip": "Skip step",
    "cook.action.startTimer": "Start timer",
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
    "cook.timer.paused": "Timer paused",
    "cook.timer.remaining": "Time remaining",
    "cook.timer.tray": "Active timers",
    "cook.timer.dishLabel": "{dish} timer, {time}",
    "cook.control.addDish": "Add dish",
    "cook.control.discard": "Discard session",
    "cook.control.finish": "Finish session",
    "cook.control.removeDish": "Remove {dish}",
  };
  return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ""));
};
jest.mock("../../lib/i18n", () => ({ useT: () => translate }));

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

function dish(id: string, title: string, currentStep: CookingStep): CookingDish {
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
    steps: [currentStep],
  };
}

function controller(overrides: Partial<MobileCookingSessionController> = {}): MobileCookingSessionController {
  const session: CookingSession = {
    id: "session-1",
    version: 1,
    created_at: "2026-08-27T11:00:00.000Z",
    updated_at: "2026-08-27T11:00:00.000Z",
    dishes: [
      dish("tofu", "Mapo tofu", step()),
      dish("rice", "Steamed rice", step({
        id: "step-rice",
        recipe_step_id: "recipe-step-rice",
        text: "Steam rice",
        duration_seconds: 900,
        attention_type: "passive",
        action_type: "simmer",
      })),
    ],
  };
  return {
    status: "ready",
    session,
    error: null,
    actionError: null,
    sessionBusy: false,
    selectedDishId: "tofu",
    refresh: jest.fn(),
    acceptSession: jest.fn(),
    focusDish: jest.fn(),
    applyAction: jest.fn(),
    addDishes: jest.fn(),
    removeDish: jest.fn(),
    finishSession: jest.fn(),
    discardSession: jest.fn(),
    ...overrides,
  };
}

test("shows a hands-on step without a countdown and completes explicitly", async () => {
  const current = controller();
  await render(<CookWorkspace controller={current} />);

  expect(screen.getByText("Chop the tofu")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/Time remaining/)).not.toBeOnTheScreen();
  const complete = screen.getByRole("button", { name: "Complete step" });
  expect(StyleSheet.flatten(complete.props.style).minHeight).toBeGreaterThanOrEqual(44);
  await fireEvent.press(complete);
  expect(current.applyAction).toHaveBeenCalledWith("tofu", "step-tofu", "complete");
});

test("keeps every dish available and starts passive timers explicitly", async () => {
  const current = controller();
  await render(<CookWorkspace controller={current} />);
  await fireEvent.press(screen.getByRole("button", { name: "Focus Steamed rice" }));
  expect(current.focusDish).toHaveBeenCalledWith("rice");

  const riceFocused = controller({ selectedDishId: "rice" });
  await render(<CookWorkspace controller={riceFocused} />);
  await fireEvent.press(screen.getAllByRole("button", { name: "Start timer" })[0]);
  expect(riceFocused.applyAction).toHaveBeenCalledWith("rice", "step-rice", "start_timer");
});

test("keeps running and attention timers visible in the persistent tray", async () => {
  const running = step({
    id: "step-rice",
    recipe_step_id: "recipe-step-rice",
    attention_type: "passive",
    action_type: "simmer",
    state: "timer_running",
    timer_started_at: new Date(Date.now() - 60_000).toISOString(),
    timer_ends_at: new Date(Date.now() + 480_000).toISOString(),
  });
  const attention = step({
    state: "needs_attention",
    attention_type: "passive",
    timer_started_at: new Date(Date.now() - 180_000).toISOString(),
    timer_ends_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const current = controller({
    session: {
      ...controller().session!,
      dishes: [dish("tofu", "Mapo tofu", attention), dish("rice", "Steamed rice", running)],
    },
  });
  await render(<CookWorkspace controller={current} />);

  expect(screen.getByLabelText(/Mapo tofu timer/)).toBeOnTheScreen();
  expect(screen.getByLabelText(/Steamed rice timer/)).toBeOnTheScreen();
  expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);
});
