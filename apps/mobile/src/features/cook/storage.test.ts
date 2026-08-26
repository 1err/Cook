import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CookingSessionCacheEnvelope } from "@cooking/shared";
import { cookingStorageKey, readCookingStorage, updateCookingStorage, writeCookingStorage } from "./storage";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const envelope: CookingSessionCacheEnvelope = {
  version: 1,
  user_id: "alice",
  session: null,
  queue: [],
  device_id: "device-1",
  preferences: { notifications: false, sound: true, vibration: true, keep_awake: true },
  updated_at: "2026-08-27T12:00:00.000Z",
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test("persists one validated envelope per signed-in user", async () => {
  await writeCookingStorage("alice", envelope);
  expect(await readCookingStorage("alice")).toEqual(envelope);
  expect(await readCookingStorage("bob")).toBeNull();
  expect(cookingStorageKey("alice")).toBe("cookingSession:v1:alice");
});

test("serializes concurrent envelope updates without losing either change", async () => {
  await writeCookingStorage("alice", envelope);

  await Promise.all([
    updateCookingStorage("alice", (current) => ({
      ...current!,
      preferences: { ...current!.preferences, notifications: true },
    })),
    updateCookingStorage("alice", (current) => ({
      ...current!,
      preferences: { ...current!.preferences, keep_awake: false },
    })),
  ]);

  expect((await readCookingStorage("alice"))?.preferences).toMatchObject({
    notifications: true,
    keep_awake: false,
  });
});
