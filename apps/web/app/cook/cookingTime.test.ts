import { expect, test } from "vitest";
import { formatCookingTime, getRemainingSeconds } from "./cookingTime";

test("derives whole remaining seconds from an absolute deadline without interval drift", () => {
  expect(
    getRemainingSeconds(
      "2026-08-27T00:10:00.000Z",
      Date.parse("2026-08-27T00:08:29.500Z"),
    ),
  ).toBe(91);
  expect(getRemainingSeconds("2026-08-27T00:08:00.000Z", Date.parse("2026-08-27T00:08:29Z"))).toBe(0);
});

test("formats timer values as clock text including long waits", () => {
  expect(formatCookingTime(65)).toBe("1:05");
  expect(formatCookingTime(3_661)).toBe("1:01:01");
});
