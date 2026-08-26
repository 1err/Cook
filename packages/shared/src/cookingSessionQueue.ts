import type { CookingActionPayload, CookingSession } from "./cookingSession";

export type QueuedCookingAction = {
  session_id: string;
  dish_id: string;
  step_id: string;
  payload: CookingActionPayload;
  enqueued_at: string;
};

export type CookingSessionPreferences = {
  notifications: boolean;
  sound: boolean;
  vibration: boolean;
  keep_awake: boolean;
};

export function defaultCookingSessionPreferences(): CookingSessionPreferences {
  return { notifications: false, sound: true, vibration: true, keep_awake: true };
}

export type CookingSessionCacheEnvelope = {
  version: 1;
  user_id: string;
  session: CookingSession | null;
  queue: QueuedCookingAction[];
  device_id: string;
  preferences: CookingSessionPreferences;
  updated_at: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validSession(value: unknown): value is CookingSession | null {
  return value === null || (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.version === "number" &&
    Array.isArray(value.dishes)
  );
}

function validPayload(value: unknown): value is CookingActionPayload {
  return record(value) &&
    typeof value.action === "string" &&
    typeof value.mutation_id === "string" &&
    typeof value.device_id === "string" &&
    typeof value.occurred_at === "string" &&
    typeof value.expected_revision === "number";
}

function validQueue(value: unknown): value is QueuedCookingAction[] {
  return Array.isArray(value) && value.every((item) =>
    record(item) &&
    typeof item.session_id === "string" &&
    typeof item.dish_id === "string" &&
    typeof item.step_id === "string" &&
    typeof item.enqueued_at === "string" &&
    validPayload(item.payload),
  );
}

function validPreferences(value: unknown): value is CookingSessionPreferences {
  return record(value) &&
    typeof value.notifications === "boolean" &&
    typeof value.sound === "boolean" &&
    typeof value.vibration === "boolean" &&
    typeof value.keep_awake === "boolean";
}

export function enqueueCookingAction(
  queue: QueuedCookingAction[],
  action: QueuedCookingAction,
): QueuedCookingAction[] {
  return queue.some((item) => item.payload.mutation_id === action.payload.mutation_id)
    ? queue
    : [...queue, action];
}

export function removeQueuedCookingAction(
  queue: QueuedCookingAction[],
  mutationId: string,
): QueuedCookingAction[] {
  return queue.filter((item) => item.payload.mutation_id !== mutationId);
}

export function replaceCachedSession(
  envelope: CookingSessionCacheEnvelope,
  session: CookingSession | null,
  updatedAt = new Date().toISOString(),
): CookingSessionCacheEnvelope {
  return { ...envelope, session, updated_at: updatedAt };
}

export function parseCookingSessionCache(
  input: unknown,
  expectedUserId: string,
): CookingSessionCacheEnvelope | null {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return null;
    }
  }
  if (!record(value) || value.version !== 1 || value.user_id !== expectedUserId) return null;
  if (
    !validSession(value.session) ||
    !validQueue(value.queue) ||
    typeof value.device_id !== "string" ||
    !validPreferences(value.preferences) ||
    typeof value.updated_at !== "string"
  ) return null;
  return value as CookingSessionCacheEnvelope;
}
