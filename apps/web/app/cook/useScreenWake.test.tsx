import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useScreenWake } from "./useScreenWake";

const release = vi.fn().mockResolvedValue(undefined);
const request = vi.fn().mockResolvedValue({ release });

beforeEach(() => {
  request.mockClear();
  release.mockClear();
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
});

test("requests screen wake while cooking and releases it on cleanup", async () => {
  const view = renderHook(() => useScreenWake(true, true));
  await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
  view.unmount();
  await waitFor(() => expect(release).toHaveBeenCalled());
});
