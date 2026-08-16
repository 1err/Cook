import { expect, test } from "vitest";
import { isStaleUpdatedAt } from "./cacheFreshness";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const TTL_MS = 86_400_000;

test("preview classifies exact and over-24-hour entries as stale", () => {
  expect(isStaleUpdatedAt("2026-08-15T12:00:00.001Z", TTL_MS, NOW)).toBe(false);
  expect(isStaleUpdatedAt("2026-08-15T12:00:00.000Z", TTL_MS, NOW)).toBe(true);
  expect(isStaleUpdatedAt("2026-08-15T11:59:59.999Z", TTL_MS, NOW)).toBe(true);
});
