import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearUserScopedPersistent } from "./storage";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test("logout cleanup removes cooking and planner account state but keeps unrelated preferences", async () => {
  await AsyncStorage.multiSet([
    ["cookingSession:v1:user-1", "cooking"],
    ["plannerWeekFingerprint:user-1", "planner"],
    ["cooking-ui-language", "zh"],
  ]);

  await clearUserScopedPersistent();

  expect(await AsyncStorage.getItem("cookingSession:v1:user-1")).toBeNull();
  expect(await AsyncStorage.getItem("plannerWeekFingerprint:user-1")).toBeNull();
  expect(await AsyncStorage.getItem("cooking-ui-language")).toBe("zh");
});
