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
  expect(screen.getByRole("tab", { name: "Menu maker" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Menu maker" })).toHaveAttribute("aria-selected", "true");
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
