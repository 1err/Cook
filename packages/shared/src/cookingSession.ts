import type { IngredientItem } from "./types";
import type {
  RecipeActionType,
  RecipeAttentionType,
  RecipeDurationSource,
} from "./recipeTutorial";

export type CookingStepState =
  | "locked"
  | "ready"
  | "timer_running"
  | "timer_paused"
  | "needs_attention"
  | "completed"
  | "skipped";

export type CookingAction =
  | "start_timer"
  | "pause_timer"
  | "resume_timer"
  | "extend_timer"
  | "complete"
  | "skip"
  | "reopen"
  | "take_alert_ownership";

export type CookingActionPayload = {
  action: CookingAction;
  mutation_id: string;
  device_id: string;
  occurred_at: string;
  expected_revision: number;
  extension_seconds?: number;
};

export type CookingStep = {
  id: string;
  recipe_step_id: string;
  position: number;
  text: string;
  duration_seconds: number;
  duration_source: RecipeDurationSource;
  attention_type: RecipeAttentionType;
  action_type: RecipeActionType;
  image_url: string | null;
  state: CookingStepState;
  timer_started_at: string | null;
  timer_ends_at: string | null;
  paused_remaining_seconds: number | null;
  resolved_at: string | null;
  notification_owner_device_id: string | null;
  revision: number;
  updated_at: string;
};

export type CookingDish = {
  id: string;
  recipe_id: string;
  position: number;
  title: string;
  thumbnail_url: string | null;
  ingredients: IngredientItem[];
  equipment: string[];
  tips: string[];
  created_at: string;
  steps: CookingStep[];
};

export type CookingSession = {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  dishes: CookingDish[];
};

export type CookingRecommendationKind = "attention" | "timer" | "ready";

export type CookingRecommendation = {
  id: string;
  kind: CookingRecommendationKind;
  priority: number;
  dish_id: string;
  step_id?: string;
  message_key: string;
  message_params: Record<string, string | number>;
  reason_code: string;
  due_at?: string;
};

const RESOLVED_STATES = new Set<CookingStepState>(["completed", "skipped"]);
const ACTIVE_TIMER_STATES = new Set<CookingStepState>([
  "timer_running",
  "timer_paused",
  "needs_attention",
]);

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getEffectiveStepState(step: CookingStep, nowMs = Date.now()): CookingStepState {
  const endsAt = timestamp(step.timer_ends_at);
  if (step.state === "timer_running" && endsAt !== null && endsAt <= nowMs) {
    return "needs_attention";
  }
  return step.state;
}

export function getDishProgress(dish: CookingDish): number {
  const total = dish.steps.reduce((sum, step) => sum + Math.max(0, step.duration_seconds), 0);
  if (total <= 0) return 0;
  const resolved = dish.steps.reduce(
    (sum, step) =>
      sum + (RESOLVED_STATES.has(step.state) ? Math.max(0, step.duration_seconds) : 0),
    0,
  );
  if (resolved >= total) return 100;
  return Math.round((resolved / total) * 100);
}

export function isCookingDishDone(dish: CookingDish): boolean {
  return dish.steps.length > 0 && dish.steps.every((step) => RESOLVED_STATES.has(step.state));
}

export function isCookingSessionComplete(session: CookingSession): boolean {
  return session.dishes.length > 0 && session.dishes.every(isCookingDishDone);
}

export function getCurrentCookingStep(dish: CookingDish): CookingStep | null {
  return (
    dish.steps.find((step) =>
      ["ready", "timer_running", "timer_paused", "needs_attention"].includes(step.state),
    ) ?? null
  );
}

export function getCookingRecommendations(
  session: CookingSession,
  nowMs = Date.now(),
): CookingRecommendation[] {
  const recommendations: Array<CookingRecommendation & { dishPosition: number; stepPosition: number }> = [];

  for (const dish of session.dishes) {
    for (const step of dish.steps) {
      const effective = getEffectiveStepState(step, nowMs);
      if (effective === "needs_attention") {
        const elapsedButUnpersisted = step.state === "timer_running";
        recommendations.push({
          id: `${elapsedButUnpersisted ? "elapsed" : "attention"}:${step.id}`,
          kind: "attention",
          priority: elapsedButUnpersisted ? 0 : 1,
          dish_id: dish.id,
          step_id: step.id,
          message_key: "cook.recommendation.checkNow",
          message_params: { dish: dish.title },
          reason_code: elapsedButUnpersisted ? "timer_elapsed" : "needs_attention",
          ...(step.timer_ends_at ? { due_at: step.timer_ends_at } : {}),
          dishPosition: dish.position,
          stepPosition: step.position,
        });
      } else if (effective === "timer_running") {
        recommendations.push({
          id: `timer:${step.id}`,
          kind: "timer",
          priority: 2,
          dish_id: dish.id,
          step_id: step.id,
          message_key: "cook.recommendation.timerRunning",
          message_params: { dish: dish.title },
          reason_code: "timer_running",
          ...(step.timer_ends_at ? { due_at: step.timer_ends_at } : {}),
          dishPosition: dish.position,
          stepPosition: step.position,
        });
      } else if (effective === "ready" && step.attention_type === "hands_on") {
        recommendations.push({
          id: `ready:${step.id}`,
          kind: "ready",
          priority: 3,
          dish_id: dish.id,
          step_id: step.id,
          message_key: "cook.recommendation.ready",
          message_params: { dish: dish.title },
          reason_code: "ready_hands_on",
          dishPosition: dish.position,
          stepPosition: step.position,
        });
      }
    }
  }

  return recommendations
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      if (left.kind === "timer" && right.kind === "timer") {
        const dueDifference = (timestamp(left.due_at) ?? Infinity) - (timestamp(right.due_at) ?? Infinity);
        if (dueDifference !== 0) return dueDifference;
      }
      return left.dishPosition - right.dishPosition || left.stepPosition - right.stepPosition;
    })
    .map(({ dishPosition: _dishPosition, stepPosition: _stepPosition, ...item }) => item);
}

export class CookingTransitionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CookingTransitionError";
  }
}

function requireState(step: CookingStep, allowed: CookingStepState[]): void {
  if (!allowed.includes(step.state)) {
    throw new CookingTransitionError(
      "invalid_transition",
      `Cannot apply this action while the step is ${step.state}.`,
    );
  }
}

function clearedTimer(step: CookingStep): CookingStep {
  return {
    ...step,
    timer_started_at: null,
    timer_ends_at: null,
    paused_remaining_seconds: null,
    notification_owner_device_id: null,
  };
}

export function applyOptimisticCookingAction(
  session: CookingSession,
  dishId: string,
  stepId: string,
  payload: CookingActionPayload,
): CookingSession {
  const dishIndex = session.dishes.findIndex((dish) => dish.id === dishId);
  if (dishIndex < 0) throw new CookingTransitionError("dish_not_found", "Dish not found.");
  const originalDish = session.dishes[dishIndex];
  const stepIndex = originalDish.steps.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) throw new CookingTransitionError("step_not_found", "Step not found.");
  const originalStep = originalDish.steps[stepIndex];
  if (originalStep.revision !== payload.expected_revision) {
    throw new CookingTransitionError("revision_conflict", "The step changed on another device.");
  }

  const occurredMs = timestamp(payload.occurred_at);
  if (occurredMs === null) {
    throw new CookingTransitionError("invalid_transition", "Action time is invalid.");
  }
  const occurredAt = new Date(occurredMs).toISOString();
  const steps = originalDish.steps.map((step) => ({ ...step }));
  let next = steps[stepIndex];

  switch (payload.action) {
    case "start_timer": {
      requireState(next, ["ready"]);
      if (next.attention_type !== "passive") {
        throw new CookingTransitionError("timer_requires_passive_step", "Only passive steps use timers.");
      }
      next = {
        ...next,
        state: "timer_running",
        timer_started_at: occurredAt,
        timer_ends_at: new Date(occurredMs + next.duration_seconds * 1_000).toISOString(),
        paused_remaining_seconds: null,
        notification_owner_device_id: payload.device_id,
      };
      break;
    }
    case "pause_timer": {
      requireState(next, ["timer_running"]);
      const endsAt = timestamp(next.timer_ends_at) ?? occurredMs;
      next = {
        ...next,
        state: "timer_paused",
        paused_remaining_seconds: Math.max(0, Math.ceil((endsAt - occurredMs) / 1_000)),
        timer_ends_at: null,
      };
      break;
    }
    case "resume_timer": {
      requireState(next, ["timer_paused"]);
      const remaining = Math.max(0, next.paused_remaining_seconds ?? next.duration_seconds);
      next = {
        ...next,
        state: "timer_running",
        timer_started_at: occurredAt,
        timer_ends_at: new Date(occurredMs + remaining * 1_000).toISOString(),
        paused_remaining_seconds: null,
        notification_owner_device_id: payload.device_id,
      };
      break;
    }
    case "extend_timer": {
      requireState(next, ["timer_running", "timer_paused", "needs_attention"]);
      const extension = payload.extension_seconds;
      if (!Number.isInteger(extension) || !extension || extension < 1 || extension > 86_400) {
        throw new CookingTransitionError("invalid_extension", "Timer extension is invalid.");
      }
      if (next.state === "timer_paused") {
        next = {
          ...next,
          paused_remaining_seconds: (next.paused_remaining_seconds ?? 0) + extension,
        };
      } else {
        const base = next.state === "timer_running" ? Math.max(occurredMs, timestamp(next.timer_ends_at) ?? occurredMs) : occurredMs;
        next = {
          ...next,
          state: "timer_running",
          timer_started_at: next.timer_started_at ?? occurredAt,
          timer_ends_at: new Date(base + extension * 1_000).toISOString(),
          paused_remaining_seconds: null,
          notification_owner_device_id: payload.device_id,
        };
      }
      break;
    }
    case "complete":
    case "skip": {
      requireState(next, ["ready", "timer_running", "timer_paused", "needs_attention"]);
      next = {
        ...clearedTimer(next),
        state: payload.action === "complete" ? "completed" : "skipped",
        resolved_at: occurredAt,
      };
      const lockedIndex = steps.findIndex((step) => step.state === "locked");
      if (lockedIndex >= 0) {
        steps[lockedIndex] = {
          ...steps[lockedIndex],
          state: "ready",
          revision: steps[lockedIndex].revision + 1,
          updated_at: occurredAt,
        };
      }
      break;
    }
    case "reopen": {
      requireState(next, ["completed", "skipped"]);
      if (steps.some((step) => ACTIVE_TIMER_STATES.has(step.state))) {
        throw new CookingTransitionError(
          "active_timer_blocks_reopen",
          "Pause or resolve the active timer before reopening a step.",
        );
      }
      steps.forEach((step, index) => {
        if (index !== stepIndex && step.state === "ready") {
          steps[index] = {
            ...step,
            state: "locked",
            revision: step.revision + 1,
            updated_at: occurredAt,
          };
        }
      });
      next = { ...clearedTimer(next), state: "ready", resolved_at: null };
      break;
    }
    case "take_alert_ownership": {
      requireState(next, ["timer_running", "timer_paused", "needs_attention"]);
      next = { ...next, notification_owner_device_id: payload.device_id };
      break;
    }
  }

  steps[stepIndex] = {
    ...next,
    revision: next.revision + 1,
    updated_at: occurredAt,
  };
  const dishes = session.dishes.map((dish, index) =>
    index === dishIndex ? { ...dish, steps } : dish,
  );
  return {
    ...session,
    dishes,
    version: session.version + 1,
    updated_at: occurredAt,
  };
}
