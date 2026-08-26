import { beforeEach, expect, test, vi } from "vitest";
import type { CookingSessionCacheEnvelope } from "@cooking/shared";
import { clearCookingStorage, cookingStorageKey, readCookingStorage, writeCookingStorage } from "./cookingStorage";

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

function envelope(userId: string): CookingSessionCacheEnvelope {
  return {
    version: 1,
    user_id: userId,
    session: null,
    queue: [],
    device_id: "device-1",
    preferences: { notifications: false, sound: true, vibration: true, keep_awake: true },
    updated_at: "2026-08-27T12:00:00.000Z",
  };
}

test("stores and reads only the requested user's session envelope", () => {
  writeCookingStorage("alice", envelope("alice"));
  expect(readCookingStorage("alice")).toEqual(envelope("alice"));
  expect(readCookingStorage("bob")).toBeNull();
  expect(cookingStorageKey("alice")).toBe("cookingSession:v1:alice");
});

test("clears cooking state without deleting unrelated preferences", () => {
  writeCookingStorage("alice", envelope("alice"));
  localStorage.setItem("theme", "warm");
  clearCookingStorage("alice");
  expect(readCookingStorage("alice")).toBeNull();
  expect(localStorage.getItem("theme")).toBe("warm");
});
