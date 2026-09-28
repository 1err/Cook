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
  expect(screen.queryByRole("region", { name: "Planner screenshot preview" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Enlarge Planner screenshot" }));
  expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute("src", "/brand/features/07-planner.webp");
  await user.click(screen.getByRole("button", { name: "Close screenshot" }));
  await user.click(screen.getByRole("tab", { name: "Menu maker" }));
  await user.click(screen.getByRole("button", { name: "Enlarge Menu maker screenshot" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/brand/features/menu-maker-demo.webp");
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
  for (const [label, asset] of [["Recipes", "recipes"], ["Shopping", "shopping"]]) {
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

test("Cook video waits for a click, replays, and stops on tab changes without API calls", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  render(<HomePage />);
  await user.click(screen.getByRole("tab", { name: "Cook" }));
  const video = screen.getByLabelText("Short cooking preview") as HTMLVideoElement;
  expect(video).toHaveAttribute("controls");
  expect(video).toHaveAttribute("playsinline");
  expect(video).toHaveAttribute("preload", "none");
  expect(video).toHaveAttribute("poster", "/brand/features/08-cook.webp");
  expect(video).not.toHaveAttribute("autoplay");
  expect(video.querySelector("source")).toHaveAttribute("src", "/brand/features/cook-preview.mp4");
  expect(screen.queryByRole("button", { name: "Complete & next step" })).not.toBeInTheDocument();
  expect(play).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Play cooking preview" }));
  expect(play).toHaveBeenCalledTimes(1);
  expect(play.mock.contexts[0]).toBe(video);
  video.currentTime = 9;
  fireEvent.ended(video);
  await user.click(screen.getByRole("button", { name: "Replay cooking preview" }));
  expect(video.currentTime).toBe(0);
  expect(play).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("tab", { name: "Muse" }));
  expect(video).not.toBeInTheDocument();
  expect(pause.mock.contexts).toContain(video);
  await user.click(screen.getByRole("tab", { name: "Cook" }));
  expect(screen.getByLabelText("Short cooking preview")).not.toBe(video);
  expect(screen.getByRole("button", { name: "Play cooking preview" })).toBeVisible();
  expect(play).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));
  expect(screen.getByLabelText("烹饪功能短预览")).toBeVisible();
  expect(screen.getByRole("button", { name: "播放烹饪预览" })).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["play", "source"])("Cook %s failure shows an explicit static screenshot fallback", async (failure) => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("unavailable"));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const user = userEvent.setup();
  render(<HomePage />);
  await user.click(screen.getByRole("tab", { name: "Cook" }));
  if (failure === "play") await user.click(screen.getByRole("button", { name: "Play cooking preview" }));
  else fireEvent.error(screen.getByLabelText("Short cooking preview").querySelector("source")!);
  expect(await screen.findByRole("status")).toHaveTextContent("The cooking preview could not play");
  expect(screen.queryByLabelText("Short cooking preview")).not.toBeInTheDocument();
  expect(within(screen.getByRole("tabpanel")).getByRole("img")).toHaveAttribute("src", "/brand/features/08-cook.webp");
  await user.click(screen.getByRole("button", { name: "Enlarge Cook screenshot" }));
  expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute("src", "/brand/features/08-cook.webp");
  await user.click(screen.getByRole("button", { name: "Close screenshot" }));
  await user.click(screen.getByRole("button", { name: "Switch to Chinese" }));
  expect(screen.getByRole("status")).toHaveTextContent("烹饪预览暂时无法播放");
});
