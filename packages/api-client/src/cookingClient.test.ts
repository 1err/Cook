import { afterEach, describe, expect, test, vi } from "vitest";
import type { CookingActionPayload, CookingSession } from "@cooking/shared";
import { ApiError, createApiClient } from "./index";

const action: CookingActionPayload = {
  action: "complete",
  mutation_id: "60000000-0000-0000-0000-000000000001",
  device_id: "device-a",
  occurred_at: "2026-08-27T12:00:00.000Z",
  expected_revision: 3,
};

const session: CookingSession = {
  id: "20000000-0000-0000-0000-000000000001",
  version: 4,
  created_at: "2026-08-27T11:00:00.000Z",
  updated_at: "2026-08-27T12:00:00.000Z",
  dishes: [],
};

function client() {
  return createApiClient({ baseUrl: "https://api.example/", auth: { kind: "cookie" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cooking session client", () => {
  test("sends the complete idempotent step-action contract to the encoded route", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(session), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    const result = await client().cooking.action("session / one", "step / one", action);

    expect(result).toEqual(session);
    expect(requests).toEqual([
      {
        url: "https://api.example/cooking-session/session%20%2F%20one/steps/step%20%2F%20one/actions",
        init: expect.objectContaining({
          method: "POST",
          body: JSON.stringify(action),
          credentials: "include",
        }),
      },
    ]);
  });

  test("creates and adds dishes using recipe-id request bodies", async () => {
    const requests: Array<{ url: string; body: string | null | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      async (url: string, init: RequestInit) => {
        requests.push({ url, body: init.body as string | null | undefined });
        return new Response(JSON.stringify(session), { status: 200 });
      },
    );

    await client().cooking.create(["rice", "tofu"]);
    await client().cooking.addDishes("session-1", ["soup"]);

    expect(requests).toEqual([
      {
        url: "https://api.example/cooking-session",
        body: JSON.stringify({ recipe_ids: ["rice", "tofu"] }),
      },
      {
        url: "https://api.example/cooking-session/session-1/dishes",
        body: JSON.stringify({ recipe_ids: ["soup"] }),
      },
    ]);
  });

  test("preserves FastAPI stable conflict metadata for recovery decisions", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            detail: {
              code: "revision_conflict",
              message: "This step changed on another device.",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    );

    const caught = await client().cooking.active().catch((error) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 409,
      code: "revision_conflict",
      message: "This step changed on another device.",
    });
  });

  test("keeps plain-text failures backward compatible", async () => {
    vi.stubGlobal("fetch", async () => new Response("Gateway unavailable", { status: 503 }));

    const caught = await client().recipes.list().catch((error) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 503, code: null, message: "Gateway unavailable" });
  });
});
