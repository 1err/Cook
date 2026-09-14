import { expect, test } from "vitest";
import { isAdminUser } from "./admin";

test("only a server-issued boolean admin role grants admin navigation", () => {
  expect(isAdminUser({ email: "jerryxiang24@gmail.com" })).toBe(false);
  expect(isAdminUser({ is_admin: true } as never)).toBe(true);
  expect(isAdminUser({ is_admin: "true" } as never)).toBe(false);
  expect(isAdminUser(null)).toBe(false);
});
