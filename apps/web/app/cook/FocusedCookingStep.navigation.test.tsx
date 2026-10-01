import { useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

function dishFixture(): CookingDish {
  const names = ["Prepare the ingredients", "Simmer the sauce", "Gently add the tofu", "Finish the sauce", "Garnish and serve"];
  return {
    id: "tofu", recipe_id: "recipe-tofu", position: 0, title: "Mapo tofu", thumbnail_url: "/tofu.jpg",
    ingredients: [], equipment: [], tips: [], created_at: new Date(now).toISOString(),
    steps: names.map((text, position): CookingStep => ({
      id: `step-${position}`, recipe_step_id: `recipe-step-${position}`, position, text,
      duration_seconds: position === 1 ? 600 : 60, duration_source: "stated",
      attention_type: position === 1 ? "passive" : "hands_on", action_type: position === 1 ? "simmer" : "mix",
      image_url: null, state: position === 0 ? "completed" : position === 1 ? "timer_running" : "locked",
      timer_started_at: position === 1 ? new Date(now).toISOString() : null,
      timer_ends_at: position === 1 ? new Date(now + 600_000).toISOString() : null,
      paused_remaining_seconds: null, resolved_at: position === 0 ? new Date(now).toISOString() : null,
      notification_owner_device_id: position === 1 ? "device-a" : null, revision: 1, updated_at: new Date(now).toISOString(),
    })),
  };
}

function SessionHarness({ layout = "focused" }: { layout?: "focused" | "stacked" }) {
  const [dish, setDish] = useState(dishFixture);
  return <I18nProvider><FocusedCookingStep dish={dish} layout={layout} onAction={async (stepId, action, extensionSeconds) => {
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
  test(`${layout}: previous and next revisit instructions without resetting the live timer`, async () => {
    const user = userEvent.setup();
    render(<SessionHarness layout={layout} />);
    const card = screen.getByTestId(layout === "focused" ? "focused-step" : "stacked-step");
    expect(within(card).getByText("Simmer the sauce", { exact: true })).toBeVisible();
    expect(within(card).getByRole("timer")).toHaveTextContent("10:00");
    await user.click(within(card).getByRole("button", { name: "Previous step", exact: true }));
    expect(within(card).getByText("Prepare the ingredients", { exact: true })).toBeVisible();
    expect(within(card).getByRole("timer")).toHaveTextContent("10:00");
    expect(within(card).getByText("Timer for step 2", { exact: true })).toBeVisible();
    expect(card.querySelector("img")).toHaveAttribute("src", "/tofu.jpg");
    await user.click(within(card).getByRole("button", { name: "Pause timer", exact: true }));
    expect(within(card).getByRole("button", { name: "Resume timer", exact: true })).toBeVisible();
    await user.click(within(card).getByRole("button", { name: "Next step", exact: true }));
    expect(within(card).getByText("Simmer the sauce", { exact: true })).toBeVisible();
    expect(within(card).getByRole("timer")).toHaveTextContent("10:00");
    await user.click(within(card).getByRole("button", { name: "Next step", exact: true }));
    expect(within(card).getByText("Gently add the tofu", { exact: true })).toBeVisible();
    expect(within(card).queryByRole("timer")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
  });
}

test("hover previews only the following three instructions and tap pins the preview", async () => {
  const user = userEvent.setup();
  render(<SessionHarness />);
  const trigger = screen.getByRole("button", { name: "Up next", exact: true });
  await user.hover(trigger);
  const preview = screen.getByRole("region", { name: "Next steps for Mapo tofu" });
  expect(within(preview).getAllByRole("listitem")).toHaveLength(3);
  expect(within(preview).getByText("Gently add the tofu", { exact: true })).toBeVisible();
  expect(within(preview).queryByText("Prepare the ingredients")).not.toBeInTheDocument();
  await user.unhover(trigger);
  expect(screen.queryByRole("region", { name: "Next steps for Mapo tofu" })).not.toBeInTheDocument();
  await user.click(trigger);
  await user.unhover(trigger);
  expect(screen.getByRole("region", { name: "Next steps for Mapo tofu" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Next steps for Mapo tofu" })).not.toBeInTheDocument();
});

test("overview previews future instructions without completing them or hiding the running timer", async () => {
  const user = userEvent.setup();
  render(<SessionHarness />);
  await user.click(screen.getByRole("button", { name: "Overview", exact: true }));
  const overview = screen.getByRole("region", { name: "Recipe overview for Mapo tofu" });
  expect(within(overview).getAllByRole("listitem")).toHaveLength(5);
  await user.click(within(overview).getByRole("button", { name: "View step 5: Garnish and serve", exact: true }));
  expect(screen.queryByRole("region", { name: "Recipe overview for Mapo tofu" })).not.toBeInTheDocument();
  expect(screen.getByText("Garnish and serve", { exact: true })).toBeVisible();
  expect(screen.getByText("Looking ahead", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Overview", exact: true })).toHaveFocus();
  expect(screen.getByRole("timer")).toHaveTextContent("10:00");
  expect(screen.queryByRole("button", { name: "Finish dish", exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Back to current step", exact: true }));
  expect(screen.getByText("Simmer the sauce", { exact: true })).toBeVisible();
  expect(screen.getByRole("timer")).toHaveTextContent("10:00");
});

test("advances the live final step once and keeps the completed recipe available for review", async () => {
  const user = userEvent.setup();
  render(<SessionHarness />);
  for (let index = 0; index < 3; index++) await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  await user.click(screen.getByRole("button", { name: "Finish dish", exact: true }));
  expect(screen.getByText("This dish is complete.", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  const overviewButton = screen.getByRole("button", { name: "Overview", exact: true });
  await user.click(overviewButton);
  await user.click(screen.getByRole("button", { name: "View step 5: Garnish and serve", exact: true }));
  expect(overviewButton).toHaveFocus();
  await user.click(overviewButton);
  await user.click(screen.getByRole("button", { name: "View step 4: Finish the sauce", exact: true }));
  expect(screen.getByRole("button", { name: "Next step", exact: true })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  await user.click(screen.getByRole("button", { name: "Previous step", exact: true }));
  expect(screen.getByText("Finish the sauce", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Next step", exact: true })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
});

test("disables previous at the first step while still allowing an overview", async () => {
  const dish = dishFixture();
  dish.steps = dish.steps.map((step, index) => ({ ...step, state: index === 0 ? "ready" : "locked", timer_started_at: null, timer_ends_at: null }));
  render(<I18nProvider><FocusedCookingStep dish={dish} onAction={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("button", { name: "Previous step", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Overview", exact: true })).toBeEnabled();
});

test("waits for step completion before allowing another advance", async () => {
  const user = userEvent.setup();
  let resolve!: () => void;
  const onAction = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  render(<I18nProvider><FocusedCookingStep dish={dishFixture()} onAction={onAction} /></I18nProvider>);
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  expect(screen.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Previous step", exact: true })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  expect(onAction).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(screen.getByRole("button", { name: "Next step", exact: true })).toBeEnabled();
});

test("keeps the current step and allows retry when advancing fails", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
  render(<I18nProvider><FocusedCookingStep dish={dishFixture()} onAction={onAction} /></I18nProvider>);
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t advance the step. Please try again.");
  expect(screen.getByText("Simmer the sauce", { exact: true })).toBeVisible();
  expect(screen.getByRole("timer")).toHaveTextContent("10:00");
  await user.click(screen.getByRole("button", { name: "Next step", exact: true }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(onAction.mock.calls).toEqual([["step-1", "complete"], ["step-1", "complete"]]);
});

test("keeps timer alert ownership tied to the live step while previewing a future one", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(<I18nProvider><FocusedCookingStep dish={dishFixture()} onAction={onAction} showAlertTakeover /></I18nProvider>);
  await user.click(screen.getByRole("button", { name: "Overview", exact: true }));
  await user.click(screen.getByRole("button", { name: "View step 4: Finish the sauce", exact: true }));
  expect(onAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Take over alerts", exact: true }));
  expect(onAction).toHaveBeenCalledWith("step-1", "take_alert_ownership");
  await user.click(screen.getByRole("button", { name: "+1 minute", exact: true }));
  expect(onAction).toHaveBeenLastCalledWith("step-1", "extend_timer", 60);
});

test("supports keyboard preview and restores focus when closing overview", async () => {
  const user = userEvent.setup();
  render(<SessionHarness />);
  const upcoming = screen.getByRole("button", { name: "Up next", exact: true });
  act(() => upcoming.focus());
  expect(screen.getByRole("region", { name: "Next steps for Mapo tofu" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Next steps for Mapo tofu" })).not.toBeInTheDocument();
  const overview = screen.getByRole("button", { name: "Overview", exact: true });
  await user.click(overview);
  await user.click(screen.getByRole("button", { name: "Close overview", exact: true }));
  expect(overview).toHaveFocus();
});
