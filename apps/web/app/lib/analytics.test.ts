import { beforeEach, expect, test, vi } from "vitest";
import {
  analyticsContext,
  analyticsHeaders,
  safeCampaign,
  trackEvent,
} from "./analytics";

beforeEach(() => {
  vi.restoreAllMocks();
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
  });
  Object.defineProperty(navigator, "doNotTrack", {
    value: undefined,
    configurable: true,
  });
});
test("campaign values reject personal data and URLs", () => {
  expect(safeCampaign("spring-launch")).toBe("spring-launch");
  expect(safeCampaign("person@example.com")).toBeUndefined();
  expect(safeCampaign("https://private.test")).toBeUndefined();
});
test("privacy opt-out avoids identifiers and network events", () => {
  Object.defineProperty(navigator, "doNotTrack", {
    value: "1",
    configurable: true,
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(analyticsContext()).toBeNull();
  trackEvent("page_view", "/library");
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});
test("session expires after inactivity while visitor remains stable", () => {
  vi.useFakeTimers();
  const first = analyticsContext(true)!;
  vi.advanceTimersByTime(31 * 60 * 1000);
  const second = analyticsContext(true)!;
  expect(second.visitor_id).toBe(first.visitor_id);
  expect(second.session_id).not.toBe(first.session_id);
  vi.useRealTimers();
});
test("background header reads do not extend an existing visit", () => {
  vi.useFakeTimers();
  const first = analyticsContext(true)!;
  vi.advanceTimersByTime(20 * 60 * 1000);
  analyticsHeaders();
  vi.advanceTimersByTime(11 * 60 * 1000);
  expect(analyticsContext(true)!.session_id).not.toBe(first.session_id);
  vi.useRealTimers();
});
