import { expect, test } from "vitest";
import type { CookingActionPayload } from "./cookingSession";
import {
  enqueueCookingAction,
  parseCookingSessionCache,
  removeQueuedCookingAction,
  replaceCachedSession,
  type CookingSessionCacheEnvelope,
  type QueuedCookingAction,
} from "./cookingSessionQueue";

const payload = (id: string): CookingActionPayload => ({
  action: "complete",
  mutation_id: id,
  device_id: "device-1",
  occurred_at: "2026-08-27T12:00:00.000Z",
  expected_revision: 2,
});
const queued = (id: string): QueuedCookingAction => ({
  session_id: "session-1",
  dish_id: "dish-1",
  step_id: "step-1",
  payload: payload(id),
  enqueued_at: "2026-08-27T12:00:00.000Z",
});
const envelope = (): CookingSessionCacheEnvelope => ({
  version: 1,
  user_id: "user-1",
  session: null,
  queue: [],
  device_id: "device-1",
  preferences: { notifications: false, sound: true, vibration: true, keep_awake: true },
  updated_at: "2026-08-27T12:00:00.000Z",
});

test("deduplicates queued actions by mutation id while preserving FIFO order", () => {
  expect(enqueueCookingAction([queued("m1")], queued("m1"))).toEqual([queued("m1")]);
  expect(enqueueCookingAction([queued("m1")], queued("m2")).map((item) => item.payload.mutation_id)).toEqual(["m1", "m2"]);
  expect(removeQueuedCookingAction([queued("m1"), queued("m2")], "m1")).toEqual([queued("m2")]);
});

test("rejects another user's or malformed persisted cache", () => {
  expect(parseCookingSessionCache(envelope(), "other-user")).toBeNull();
  expect(parseCookingSessionCache({ ...envelope(), queue: "bad" }, "user-1")).toBeNull();
  expect(parseCookingSessionCache(JSON.stringify(envelope()), "user-1")).toEqual(envelope());
});

test("replaces only canonical session data without dropping queue or preferences", () => {
  const current = { ...envelope(), queue: [queued("m1")] };
  const next = replaceCachedSession(current, null, "2026-08-27T12:01:00.000Z");
  expect(next.queue).toEqual(current.queue);
  expect(next.updated_at).toBe("2026-08-27T12:01:00.000Z");
});
