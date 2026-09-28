import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HomePage } from "./HomePage";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); });

test("homepage language is independent of the user's stored app language", async () => {
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => "zh", setItem });
  const user = userEvent.setup();
  render(<HomePage />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("A little closer");
  await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("家的味道");
  expect(screen.getByRole("main")).toHaveAttribute("lang", "zh-CN");
  expect(setItem).not.toHaveBeenCalled();
  expect(within(screen.getByRole("banner")).getByRole("link", { name: "开始使用" })).toHaveAttribute("href", "/library");
});

test("keyboard feature navigation keeps focus and enlargement on the selected real screenshot", async () => {
  const user = userEvent.setup();
  render(<HomePage />);
  const recipes = screen.getByRole("tab", { name: "Recipes" });
  recipes.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Planner" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Planner" })).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("tab", { name: "Menu maker" }));
  await user.click(screen.getByRole("button", { name: "Enlarge Menu maker screenshot" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/brand/features/menu-generated.webp");
  await user.click(within(dialog).getByRole("button", { name: "Close screenshot" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("preview waits for a click and keeps useful controls and a text alternative on playback failure", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("unavailable"));
  const user = userEvent.setup();
  render(<HomePage />);
  const video = screen.getByLabelText("30-second Chef World feature preview");
  expect(video).not.toHaveAttribute("autoplay");
  expect(video).toHaveAttribute("preload", "none");
  expect(video).toHaveAttribute("controls");
  expect(play).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Play the 30-second preview" }));
  expect(play).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("alert")).toHaveTextContent("preview could not play");
  fireEvent.click(screen.getByText("Read the preview description"));
  expect(screen.getByText("Read the preview description").closest("details")?.querySelectorAll("li")).toHaveLength(6);
});


test("orders the previews from recipes through cooking and resets native scroll regions when changing tabs", async () => {
  const user = userEvent.setup();
  render(<HomePage />);
  expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Recipes", "Planner", "Shopping", "Muse", "Menu maker", "Cook"]);
  for (const [label, asset] of [["Recipes", "recipes"], ["Planner", "planner"], ["Shopping", "shopping"]]) {
    await user.click(screen.getByRole("tab", { name: label }));
    const viewport = screen.getByRole("region", { name: `${label} screenshot preview` });
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(viewport).toHaveAccessibleDescription("Scroll to explore");
    expect(within(viewport).getByRole("img")).toHaveAttribute("src", `/brand/features/${asset}-scroll.webp`);
    expect(within(viewport).getByRole("img")).not.toHaveAttribute("height");
  }
  await user.click(screen.getByRole("tab", { name: "Recipes" }));
  screen.getByRole("region", { name: "Recipes screenshot preview" }).scrollTop = 450;
  await user.click(screen.getByRole("tab", { name: "Planner" }));
  await user.click(screen.getByRole("tab", { name: "Recipes" }));
  expect(screen.getByRole("region", { name: "Recipes screenshot preview" }).scrollTop).toBe(0);
  await user.click(screen.getByRole("button", { name: "Enlarge Recipes screenshot" }));
  const fullScreenshot = screen.getByRole("region", { name: "Enlarged Recipes screenshot" });
  expect(fullScreenshot).toHaveAttribute("tabindex", "0");
  expect(within(fullScreenshot).getByRole("img")).toHaveAttribute("src", "/brand/features/recipes-scroll.webp");
});

test("falls back to the current real screenshot if a new preview asset is unavailable", () => {
  render(<HomePage />);
  const viewport = screen.getByRole("region", { name: "Recipes screenshot preview" });
  fireEvent.error(within(viewport).getByRole("img"));
  expect(within(viewport).getByRole("img")).toHaveAttribute("src", "/brand/features/06-recipe.webp");
});

test("cycles actual cooking screenshots, enlarges the current step, and resets without API calls", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<HomePage />);
  await user.click(screen.getByRole("tab", { name: "Cook" }));
  const screenshot = () => within(screen.getByRole("button", { name: "Enlarge Cook screenshot" })).getByRole("img");
  expect(screen.getByRole("status")).toHaveTextContent("Preview 1 / 3");
  expect(screenshot()).toHaveAttribute("src", "/brand/features/cook-step-1.webp");
  await user.click(screen.getByRole("button", { name: "Complete & next step" }));
  expect(screen.getByRole("status")).toHaveTextContent("Preview 2 / 3");
  await user.click(screen.getByRole("button", { name: "Enlarge Cook screenshot" }));
  expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute("src", "/brand/features/cook-step-2.webp");
  await user.click(screen.getByRole("button", { name: "Close screenshot" }));
  await user.click(screen.getByRole("button", { name: "Complete & next step" }));
  expect(screenshot()).toHaveAttribute("src", "/brand/features/cook-step-3.webp");
  await user.click(screen.getByRole("button", { name: "Replay preview" }));
  expect(screenshot()).toHaveAttribute("src", "/brand/features/cook-step-1.webp");
  await user.click(screen.getByRole("button", { name: "Complete & next step" }));
  await user.click(screen.getByRole("tab", { name: "Muse" }));
  await user.click(screen.getByRole("tab", { name: "Cook" }));
  expect(screen.getByRole("status")).toHaveTextContent("Preview 1 / 3");
  await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));
  expect(screen.getByRole("status")).toHaveTextContent("演示 1 / 3");
  expect(screen.getByRole("button", { name: "完成并看下一步" })).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});


test("a failed cooking step shows an explicit static fallback without misleading progression", async () => {
  const user = userEvent.setup();
  render(<HomePage />);
  await user.click(screen.getByRole("tab", { name: "Cook" }));
  await user.click(screen.getByRole("button", { name: "Complete & next step" }));
  const preview = () => within(screen.getByRole("button", { name: "Enlarge Cook screenshot" })).getByRole("img");
  fireEvent.error(preview());
  expect(preview()).toHaveAttribute("src", "/brand/features/08-cook.webp");
  expect(preview().getAttribute("alt")).not.toContain("Preview 2 / 3");
  expect(screen.getByRole("status")).toHaveTextContent("The step preview is unavailable");
  expect(screen.queryByRole("button", { name: "Complete & next step" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Replay preview" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Enlarge Cook screenshot" }));
  expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute("src", "/brand/features/08-cook.webp");
  await user.click(screen.getByRole("button", { name: "Close screenshot" }));
  await user.click(screen.getByRole("tab", { name: "Recipes" }));
  await user.click(screen.getByRole("tab", { name: "Cook" }));
  expect(screen.getByRole("status")).toHaveTextContent("The step preview is unavailable");
  await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));
  expect(screen.getByRole("status")).toHaveTextContent("步骤演示暂时无法显示");
});
