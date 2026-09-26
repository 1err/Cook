import { afterEach, expect, test, vi } from "vitest";
import { ApiError, createApiClient } from "./index";

afterEach(() => vi.unstubAllGlobals());

test("planner sends zero and existing revisions while retaining explicit legacy compatibility", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ date: "2026-09-18", revision: 1 }), { status: 200 });
  });
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "cookie" } });
  const slots = { breakfast: [], lunch: [], dinner: ["rice"] };
  await client.mealPlan.updateDay("2026-09-18", slots, 0);
  await client.mealPlan.updateDay("2026-09-18", slots, 7);
  await client.mealPlan.updateDay("2026-09-18", slots);
  expect(bodies).toEqual([{ ...slots, expected_revision: 0 }, { ...slots, expected_revision: 7 }, slots]);
});

test("planner exposes the server conflict code so clients can reload safely", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: { code: "meal_plan_conflict", message: "Plan changed" } }), { status: 409 }));
  const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "cookie" } });
  await expect(client.mealPlan.updateDay("2026-09-18", { breakfast: [], lunch: [], dinner: [] }, 2)).rejects.toMatchObject({ status: 409, code: "meal_plan_conflict" } satisfies Partial<ApiError>);
});
