import { describe, expect, test } from "vitest";
import {
  applyOptimisticCookingAction,
  getCookingRecommendations,
  getDishProgress,
  getEffectiveStepState,
  type CookingAction,
  type CookingActionPayload,
  type CookingDish,
  type CookingSession,
  type CookingStep,
  type CookingStepState,
} from "./cookingSession";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");

function step(
  id: string,
  state: CookingStepState,
  durationSeconds: number,
  overrides: Partial<CookingStep> = {},
): CookingStep {
  return {
    id,
    recipe_step_id: `recipe-${id}`,
    position: Number(id.replace(/\D/g, "")) || 0,
    text: `Instruction ${id}`,
    duration_seconds: durationSeconds,
    duration_source: "estimated",
    attention_type: "hands_on",
    action_type: "other",
    image_url: null,
    state,
    timer_started_at: null,
    timer_ends_at: null,
    paused_remaining_seconds: null,
    resolved_at: null,
    notification_owner_device_id: null,
    revision: 1,
    updated_at: "2026-08-27T11:00:00.000Z",
    ...overrides,
  };
}

function dish(id: string, position: number, steps: CookingStep[]): CookingDish {
  return {
    id,
    recipe_id: `recipe-${id}`,
    position,
    title: id === "dish-a" ? "Rice" : "Mapo tofu",
    thumbnail_url: null,
    ingredients: [],
    equipment: [],
    tips: [],
    created_at: "2026-08-27T11:00:00.000Z",
    steps,
  };
}

function session(dishes: CookingDish[]): CookingSession {
  return {
    id: "session-1",
    version: 1,
    created_at: "2026-08-27T11:00:00.000Z",
    updated_at: "2026-08-27T11:00:00.000Z",
    dishes,
  };
}

function action(actionName: CookingAction, revision = 1): CookingActionPayload {
  return {
    action: actionName,
    mutation_id: `mutation-${actionName}`,
    device_id: "device-1",
    occurred_at: "2026-08-27T12:00:00.000Z",
    expected_revision: revision,
  };
}

describe("cooking session progress", () => {
  test("weights progress by resolved duration instead of step count", () => {
    const value = getDishProgress(
      dish("dish-a", 0, [step("a1", "completed", 120), step("a2", "ready", 480)]),
    );

    expect(value).toBe(20);
  });

  test("counts skipped work as resolved and reports exactly 100 for a finished dish", () => {
    const value = getDishProgress(
      dish("dish-a", 0, [step("a1", "completed", 120), step("a2", "skipped", 480)]),
    );

    expect(value).toBe(100);
  });
});

describe("effective timer state", () => {
  test("treats an elapsed running timer as needing attention without completing it", () => {
    const timer = step("a1", "timer_running", 60, {
      attention_type: "passive",
      timer_ends_at: "2026-08-27T11:59:59.000Z",
    });

    expect(getEffectiveStepState(timer, NOW)).toBe("needs_attention");
    expect(timer.state).toBe("timer_running");
  });
});

describe("next attention recommendations", () => {
  test("orders elapsed timers, persisted attention, live timers, then ready hands-on work", () => {
    const value = session([
      dish("dish-a", 0, [
        step("a1", "timer_running", 60, {
          attention_type: "passive",
          timer_ends_at: "2026-08-27T11:59:59.000Z",
        }),
        step("a2", "ready", 120),
      ]),
      dish("dish-b", 1, [
        step("b1", "needs_attention", 300, { attention_type: "passive" }),
        step("b2", "timer_running", 300, {
          attention_type: "passive",
          timer_ends_at: "2026-08-27T12:05:00.000Z",
        }),
        step("b3", "ready", 60),
      ]),
    ]);

    expect(getCookingRecommendations(value, NOW).map((item) => [item.kind, item.step_id])).toEqual([
      ["attention", "a1"],
      ["attention", "b1"],
      ["timer", "b2"],
      ["ready", "a2"],
      ["ready", "b3"],
    ]);
  });
});

describe("optimistic transitions", () => {
  test("completion advances only the same dish and increments its revisions", () => {
    const original = session([
      dish("dish-a", 0, [step("a1", "ready", 120), step("a2", "locked", 480)]),
      dish("dish-b", 1, [step("b1", "ready", 300)]),
    ]);

    const value = applyOptimisticCookingAction(original, "dish-a", "a1", action("complete"));

    expect(value.dishes[0].steps.map((item) => [item.state, item.revision])).toEqual([
      ["completed", 2],
      ["ready", 2],
    ]);
    expect(value.dishes[1]).toEqual(original.dishes[1]);
    expect(original.dishes[0].steps.map((item) => item.state)).toEqual(["ready", "locked"]);
  });

  test("starting a passive timer uses an absolute end time and assigns alert ownership", () => {
    const original = session([
      dish("dish-a", 0, [step("a1", "ready", 90, { attention_type: "passive" })]),
    ]);

    const value = applyOptimisticCookingAction(original, "dish-a", "a1", action("start_timer"));
    const timer = value.dishes[0].steps[0];

    expect(timer.state).toBe("timer_running");
    expect(timer.timer_ends_at).toBe("2026-08-27T12:01:30.000Z");
    expect(timer.notification_owner_device_id).toBe("device-1");
  });
});

test("unknown-duration steps count toward progress and complete without a timer", () => {
  const unknown = step("step-1", "ready", 0, { duration_seconds: null, duration_source: "unknown", attention_type: "passive" });
  const current = session([dish("dish-a", 0, [unknown, step("step-2", "locked", 120)])]);
  expect(() => applyOptimisticCookingAction(current, "dish-a", "step-1", action("start_timer"))).toThrow("Set a duration");
  const completed = applyOptimisticCookingAction(current, "dish-a", "step-1", action("complete"));
  expect(getDishProgress(completed.dishes[0])).toBe(50);
  const skipped = applyOptimisticCookingAction(current, "dish-a", "step-1", action("skip"));
  expect(skipped.dishes[0].steps[1].state).toBe("ready");
});


describe("independent recipe timers", () => {
  test.each(["locked", "completed", "skipped"] as const)("starts a timer on a %s browsed step without completing previous steps", state => {
    const value = session([dish("dish-a", 0, [step("a0", "ready", 120), step("a1", state, 60, {attention_type:"passive",resolved_at: state === "locked" ? null : new Date(NOW).toISOString()})])]);
    const result=applyOptimisticCookingAction(value,"dish-a","a1",action("start_timer"));
    expect(result.dishes[0].steps[0]).toEqual(value.dishes[0].steps[0]);
    expect(result.dishes[0].steps[1]).toMatchObject({state:"timer_running",resolved_at:null,timer_ends_at:new Date(NOW+60000).toISOString()});
  });
  test.each(["timer_running", "timer_paused", "needs_attention"] as const)("stops a %s timer without completing or unlocking other steps", state => {
    const value=session([dish("dish-a",0,[step("a0","ready",120),step("a1",state,60,{attention_type:"passive",timer_started_at:new Date(NOW).toISOString(),timer_ends_at:new Date(NOW+60000).toISOString(),paused_remaining_seconds:60,notification_owner_device_id:"device-1"})])]);
    const result=applyOptimisticCookingAction(value,"dish-a","a1",action("stop_timer" as CookingAction));
    expect(result.dishes[0].steps[0]).toEqual(value.dishes[0].steps[0]);
    expect(result.dishes[0].steps[1]).toMatchObject({state:"ready",resolved_at:null,timer_started_at:null,timer_ends_at:null,paused_remaining_seconds:null,notification_owner_device_id:null,revision:2});
  });
});


test.each(["timer_running", "timer_paused", "needs_attention"] as const)("a second device cannot start another timer while the dish timer is %s", state => {
  const initial = session([dish("dish-a", 0, [step("a0", "ready", 120, {attention_type:"passive"}), step("a1", "locked", 60, {attention_type:"passive"})])]);
  const running = applyOptimisticCookingAction(initial, "dish-a", "a0", action("start_timer"));
  running.dishes[0].steps[0].state = state;
  expect(() => applyOptimisticCookingAction(running, "dish-a", "a1", {...action("start_timer"), device_id:"device-2"})).toThrow("Stop the active timer");
  expect(running.dishes[0].steps[1]).toMatchObject({state:"locked", revision:1});
});
