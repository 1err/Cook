import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { RecipeCard } from "./RecipeCard";

vi.mock("next/navigation", () => ({ usePathname: () => "/library" }));

const recipe = { id: "slow", title: "Slow braised beef", total_time_minutes: 500 };
const summary = { hands_on_minutes: 20, passive_minutes: 480, is_estimate: false };

function show(total: number | null | undefined, timing: unknown = summary) {
  const result = render(<I18nProvider><RecipeCard recipe={{ ...recipe, total_time_minutes: total, timing_summary: timing } as typeof recipe} /></I18nProvider>);
  const trigger = screen.queryByRole("button");
  if (trigger) fireEvent.focus(trigger);
  return result;
}

beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("library recipe timing", () => {
  it("separates substantial passive time and keeps the recipe link intact", () => {
    show(500);
    const handsOn = screen.getByText("20 min hands-on");
    expect(handsOn).toBeVisible();
    expect(handsOn.tagName).toBe("STRONG");
    expect(screen.getByText("8 hr passive")).toBeVisible();
    expect(handsOn.closest("p")).toHaveTextContent("20 min hands-on · 8 hr passive");
    expect(screen.getByRole("tooltip")).toHaveTextContent("your attention");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/recipe/slow");
    expect(screen.getByRole("button").closest("a")).toBeNull();
  });

  it("marks the whole estimated split once", () => {
    show(500, { ...summary, is_estimate: true });
    const timing = screen.getByText("20 min hands-on").closest("p");
    expect(timing).toHaveTextContent(/^About 20 min hands-on · 8 hr passive$/);
    expect(screen.getAllByText("About")).toHaveLength(1);
  });

  it("uses Chinese duration and attention labels", () => {
    localStorage.setItem("cooking-ui-language", "zh");
    show(500, { ...summary, is_estimate: true });
    expect(screen.getByText("20 分钟动手").closest("p")).toHaveTextContent("约 20 分钟动手 · 8 小时等待");
  });

  it("keeps the recorded total and known passive subtotal when hands-on is unknown", () => {
    show(490, { ...summary, hands_on_minutes: null });
    expect(screen.getByText("8 hr 10 min total")).toBeVisible();
    expect(screen.getByText("Includes 8 hr passive")).toBeVisible();
    expect(screen.queryByText(/hands-on/)).not.toBeInTheDocument();
  });

  it("preserves a longer recorded total when step subtotals do not cover it", () => {
    show(500, { ...summary, passive_minutes: 60 });
    expect(screen.getByText("8 hr 20 min total")).toBeVisible();
    expect(screen.getByText("Includes 1 hr passive")).toBeVisible();
    expect(screen.queryByText(/hands-on/)).not.toBeInTheDocument();
  });

  it("qualifies only the known passive subtotal when that subtotal is estimated", () => {
    show(490, { ...summary, hands_on_minutes: null, is_estimate: true });
    expect(screen.getByText("8 hr 10 min total")).toBeVisible();
    expect(screen.getByText("Includes about 8 hr passive")).toBeVisible();
  });

  it.each([
    [29, { ...summary, passive_minutes: 9 }, "29 min"],
    [60, undefined, "1 hr"],
    [61, null, "1 hr 1 min"],
    [480, null, "8 hr"],
    [30, summary, "30 min"],
    [30, { ...summary, hands_on_minutes: null }, "30 min"],
    [30, { ...summary, hands_on_minutes: -1 }, "30 min"],
    [30, { ...summary, passive_minutes: NaN }, "30 min"],
    [30, { ...summary, passive_minutes: Infinity }, "30 min"],
    [30, { ...summary, passive_minutes: "10" }, "30 min"],
    [30, { ...summary, is_estimate: "yes" }, "30 min"],
  ])("shows only the total for minor waits, old payloads, or inconsistent summaries (%s)", (total, timing, expected) => {
    show(total, timing === undefined ? null : timing);
    expect(screen.getByText(expected)).toBeVisible();
    expect(screen.queryByText(/hands-on|passive/)).not.toBeInTheDocument();
  });

  it("starts splitting at ten passive minutes", () => {
    show(30, { ...summary, passive_minutes: 10 });
    expect(screen.getByText("20 min hands-on")).toBeVisible();
    expect(screen.getByText("10 min passive")).toBeVisible();
  });

  it("allows the one-minute difference from rounding step subtotals", () => {
    show(29, { ...summary, passive_minutes: 10 });
    expect(screen.getByText("20 min hands-on")).toBeVisible();
  });

  it("can display a complete trustworthy split without a recorded total", () => {
    show(null);
    expect(screen.getByText("20 min hands-on")).toBeVisible();
    expect(within(screen.getByRole("tooltip")).getByText("8 hr passive")).toBeVisible();
  });

  it.each([
    [null, false, "Includes 8 hr passive"],
    [null, true, "Includes about 8 hr passive"],
    [0, false, "8 hr passive"],
    [0, true, "About 8 hr passive"],
  ])("preserves a known long wait without total or positive hands-on time (%s, %s)", (handsOn, estimated, expected) => {
    show(null, { ...summary, hands_on_minutes: handsOn, is_estimate: estimated });
    expect(within(screen.getByRole("tooltip")).getByText((_, element) => element?.tagName === "P" && element.textContent === expected)).toBeVisible();
    expect(screen.queryByText(/hands-on|total/)).not.toBeInTheDocument();
  });

  it.each([null, undefined, 0, -1, NaN, Infinity])("omits absent or invalid totals without a reliable summary (%s)", (total) => {
    show(total, null);
    expect(screen.queryByText(/min|hr|NaN|Infinity/)).not.toBeInTheDocument();
  });
});
