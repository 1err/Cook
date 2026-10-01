import { useState } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyOptimisticCookingAction, type CookingDish, type CookingSession, type CookingStep } from "@cooking/shared";
import { I18nProvider } from "../lib/i18n";
import { FocusedCookingStep } from "./FocusedCookingStep";

const now = Date.parse("2026-10-01T18:00:00.000Z");
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
  localStorage.setItem("cooking-ui-language", "en");
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function dishFixture(timer = true): CookingDish {
  const names = ["Prepare the ingredients", "Simmer the sauce", "Gently add the tofu", "Finish the sauce", "Garnish", "Serve"];
  return {
    id: "tofu", recipe_id: "recipe-tofu", position: 0, title: "Mapo tofu", thumbnail_url: "/tofu.jpg",
    ingredients: [], equipment: [], tips: [], created_at: new Date(now).toISOString(),
    steps: names.map((text, position): CookingStep => ({
      id: `step-${position}`, recipe_step_id: `recipe-step-${position}`, position, text,
      duration_seconds: position === 1 ? 600 : 60, duration_source: "stated",
      attention_type: position === 1 ? "passive" : "hands_on", action_type: position === 1 ? "simmer" : "mix",
      image_url: null, state: timer && position === 1 ? "timer_running" : position === 0 ? "ready" : "locked",
      timer_started_at: timer && position === 1 ? new Date(now).toISOString() : null,
      timer_ends_at: timer && position === 1 ? new Date(now + 600_000).toISOString() : null,
      paused_remaining_seconds: null, resolved_at: null,
      notification_owner_device_id: timer && position === 1 ? "device-a" : null, revision: 1, updated_at: new Date(now).toISOString(),
    })),
  };
}

function SessionHarness({ layout = "focused", initial = dishFixture(), actions = vi.fn() }: { layout?: "focused" | "stacked"; initial?: CookingDish; actions?: ReturnType<typeof vi.fn> }) {
  const [dish, setDish] = useState(initial);
  return <I18nProvider><FocusedCookingStep dish={dish} layout={layout} showAlertTakeover onAction={async (stepId, action, extensionSeconds) => {
    actions(stepId, action, extensionSeconds);
    setDish(current => {
      const session: CookingSession = { id: "session", version: 1, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), dishes: [current] };
      return applyOptimisticCookingAction(session, current.id, stepId, {
        action, mutation_id: "mutation", device_id: "device-a", expected_revision: current.steps.find(step => step.id === stepId)!.revision,
        occurred_at: new Date(now).toISOString(), ...(extensionSeconds === undefined ? {} : { extension_seconds: extensionSeconds }),
      }).dishes[0];
    });
  }} /></I18nProvider>;
}

for (const layout of ["focused", "stacked"] as const) {
  test(`${layout}: next previous and overview only browse, and the percentage follows the displayed position`, async () => {
    const user = userEvent.setup();
    const actions = vi.fn();
    render(<SessionHarness layout={layout} initial={dishFixture(false)} actions={actions} />);
    const card = screen.getByTestId(layout === "focused" ? "focused-step" : "stacked-step");
    expect(within(card).getByText("17% of steps")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Next step", exact: true }));
    expect(within(card).getByText("Simmer the sauce", { exact: true })).toBeVisible();
    expect(within(card).getByText("33% of steps")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Previous step", exact: true }));
    expect(within(card).getByText("17% of steps")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Overview", exact: true }));
    await user.click(within(card).getByRole("button", { name: "View step 4: Finish the sauce", exact: true }));
    expect(within(card).getByText("67% of steps")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Next step", exact: true }));
    expect(within(card).getByText("83% of steps")).toBeInTheDocument();
    expect(card.querySelector("img")).toHaveAttribute("src", "/tofu.jpg");
    expect(actions).not.toHaveBeenCalled();
  });

  test(`${layout}: browsing away and back leaves the live timer running and targets it for timer controls`, async () => {
    const user = userEvent.setup();
    const actions = vi.fn();
    render(<SessionHarness layout={layout} actions={actions} />);
    const card = screen.getByTestId(layout === "focused" ? "focused-step" : "stacked-step");
    await user.click(within(card).getByRole("button", { name: "Overview", exact: true }));
    await user.click(within(card).getByRole("button", { name: "View step 5: Garnish", exact: true }));
    expect(within(card).getByRole("timer")).toHaveTextContent("10:00");
    expect(within(card).getByText("Timer for step 2", { exact: true })).toBeVisible();
    expect(actions).not.toHaveBeenCalled();
    await user.click(within(card).getByRole("button", { name: "Pause timer", exact: true }));
    expect(actions).toHaveBeenLastCalledWith("step-1", "pause_timer", undefined);
    expect(within(card).getByRole("timer")).toHaveTextContent("10:00");
    await user.click(within(card).getByRole("button", { name: "Back to timer", exact: true }));
    expect(within(card).getByText("Simmer the sauce", { exact: true })).toBeVisible();
  });
}

test("up next opens on hover, pins on click, and a second click closes it without moving the pointer", async () => {
  const user = userEvent.setup();
  render(<SessionHarness initial={dishFixture(false)} />);
  const trigger = screen.getByRole("button", { name: "Up next", exact: true });
  await user.hover(trigger);
  expect(screen.getByRole("region", { name: "Next steps for Mapo tofu" })).toBeVisible();
  await user.click(trigger);
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("region", { name: "Next steps for Mapo tofu" })).not.toBeInTheDocument();
  await user.click(trigger);
  expect(screen.getByRole("region", { name: "Next steps for Mapo tofu" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Next steps for Mapo tofu" }).querySelectorAll("li")).toHaveLength(3);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Next steps for Mapo tofu" })).not.toBeInTheDocument();
});

test("legacy completed steps have position progress and no completion labels", async () => {
  const user = userEvent.setup();
  const dish = dishFixture(false);
  dish.steps = dish.steps.map(step => ({ ...step, state: "completed", resolved_at: new Date(now).toISOString() }));
  const actions = vi.fn();
  render(<SessionHarness initial={dish} actions={actions} />);
  await user.click(screen.getByRole("button", { name: "Overview", exact: true }));
  expect(screen.queryByText(/Done|This dish is complete|Coming up|Cooking now/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "View step 4: Finish the sauce", exact: true }));
  expect(screen.getByText("67% of steps")).toBeVisible();
  expect(screen.queryByText("This dish is complete.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  expect(screen.getByText("100% of steps")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Finish dish" })).not.toBeInTheDocument();
  expect(actions).not.toHaveBeenCalled();
});

test("can explicitly start and stop a later step timer without completing earlier instructions", async () => {
  const user = userEvent.setup();
  const actions = vi.fn();
  render(<SessionHarness initial={dishFixture(false)} actions={actions} />);
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  expect(actions).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Start timer", exact: true }));
  expect(screen.getByRole("timer")).toHaveTextContent("10:00");
  await user.click(screen.getByRole("button", { name: "Previous step", exact: true }));
  expect(screen.getByRole("timer")).toHaveTextContent("10:00");
  await user.click(screen.getByRole("button", { name: "Stop timer", exact: true }));
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  expect(actions.mock.calls).toEqual([["step-1", "start_timer", undefined], ["step-1", "stop_timer", undefined]]);
  expect(screen.getByText("17% of steps")).toBeVisible();
});

test("keyboard preview can be closed and overview restores focus to an enabled control", async () => {
  const user = userEvent.setup();
  render(<SessionHarness initial={dishFixture(false)} />);
  const upcoming = screen.getByRole("button", { name: "Up next", exact: true });
  act(() => upcoming.focus());
  expect(screen.getByRole("region", { name: "Next steps for Mapo tofu" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Next steps for Mapo tofu" })).not.toBeInTheDocument();
  const overview = screen.getByRole("button", { name: "Overview", exact: true });
  await user.click(overview);
  await user.click(screen.getByRole("button", { name: "View step 6: Serve", exact: true }));
  expect(overview).toHaveFocus();
});
