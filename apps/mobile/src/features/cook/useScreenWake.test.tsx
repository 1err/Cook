import { renderHook } from "@testing-library/react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useScreenWake } from "./useScreenWake";

jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));

test("activates only while the visible cooking session enables screen wake", async () => {
  const view = await renderHook<void, { enabled: boolean; visible: boolean }>(
    ({ enabled, visible }) => useScreenWake(enabled, visible),
    { initialProps: { enabled: true, visible: true } },
  );
  expect(activateKeepAwakeAsync).toHaveBeenCalled();
  await view.rerender({ enabled: true, visible: false });
  expect(deactivateKeepAwake).toHaveBeenCalled();
});
