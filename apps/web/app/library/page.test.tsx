import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LibraryPage from "./page";
import { I18nProvider } from "../lib/i18n";
const state = vi.hoisted(() => ({ error: null as string | null, refresh: vi.fn(), scopes: [] as string[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/library" }));
vi.mock("../components/RequireAuth", () => ({ RequireAuth: ({children}: any) => children }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: {id:"audit"} }) }));
vi.mock("../lib/api", () => ({apiFetch: vi.fn()}));
vi.mock("../lib/useLibrarySearch", () => ({useLibrarySearch: (scope: string, _:unknown, enabled=true) => {
 if(enabled) state.scopes.push(scope);
 return {items:[], loading:false, error:state.error, refresh:state.refresh, next:null};
}}));
beforeEach(() => {vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);vi.stubGlobal("localStorage", {getItem: () => "en", setItem: vi.fn()});state.error=null;state.refresh.mockClear();state.scopes=[];});
afterEach(() => {cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
test("shows a helpful recoverable Library error instead of a browser exception", async () => {
 state.error="Failed to fetch";
 render(<I18nProvider><LibraryPage /></I18nProvider>);
 expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
 expect(screen.getByRole("alert")).toHaveTextContent("Your recipes couldn’t be loaded");
 await userEvent.click(screen.getByRole("button", {name:"Try again"}));
 expect(state.refresh).toHaveBeenCalledOnce();
});
test("an empty library offers public recipes and switches to that catalog", async () => {
 render(<I18nProvider><LibraryPage /></I18nProvider>);
 await userEvent.click(screen.getByRole("button", {name:"Browse public recipes"}));
 expect(screen.getByRole("tab", {name:"Public library"})).toHaveAttribute("aria-selected","true");
 expect(state.scopes).toContain("catalog");
 expect(screen.getByRole("tab", {name:"Friends"})).toHaveAttribute("href","/library/friends");
});
test("Chinese filters translate the summary, group, and recipe tags", async () => {
 vi.stubGlobal("localStorage", {getItem: () => "zh", setItem: vi.fn()});
 render(<I18nProvider><LibraryPage /></I18nProvider>);
 expect(await screen.findByText("全部标签")).toBeVisible();
 await userEvent.click(screen.getByRole("button", {name:"按标签筛选菜谱"}));
 expect(screen.getByText("菜系")).toBeVisible();
 await userEvent.click(screen.getByRole("button", {name:"中餐",exact:true}));
 await userEvent.click(screen.getByRole("button", {name:"完成",exact:true}));
 expect(screen.getByText("中餐")).toBeVisible();
 expect(screen.queryByText("All tags")).not.toBeInTheDocument();
});

test("restores My library as the default with Public library and Friends beside it", () => {
 render(<I18nProvider><LibraryPage /></I18nProvider>);
 expect(screen.getAllByRole("tab").map(tab=>tab.textContent)).toEqual(["My library","Public library","Friends"]);
 expect(screen.getByRole("tab",{name:"My library"})).toHaveAttribute("aria-selected","true");
 expect(screen.getByRole("tab",{name:"Friends"})).toHaveAttribute("href","/library/friends");
 expect(state.scopes).toEqual(["mine"]);
});
