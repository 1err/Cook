import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import { AuthProvider } from "../lib/auth";
import { clearUserStorage } from "../lib/userStorage";
import { AccountSecurity } from "./AccountSecurity";
const state = vi.hoisted(() => ({apiFetch: vi.fn(), capabilities: vi.fn(), router: {push: vi.fn(), replace: vi.fn()}}));
vi.mock("next/navigation", () => ({useRouter: () => state.router, useSearchParams: () => new URLSearchParams()}));
vi.mock("../lib/api", () => ({apiFetch: state.apiFetch, webApiClient: {auth: {capabilities: state.capabilities}}}));
vi.mock("../lib/i18n", () => ({useT: () => (key: string) => MESSAGE_MAP.en[key] ?? key}));
function storage() {const values = new Map<string, string>(); return {get length(){return values.size;}, key: (index:number) => [...values.keys()][index] ?? null, getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => {values.set(key,value);}, removeItem: (key:string) => {values.delete(key);}};}
beforeEach(() => {
  vi.stubGlobal("localStorage", storage()); vi.stubGlobal("sessionStorage", storage()); clearUserStorage();
  state.capabilities.mockResolvedValue({email_verification: true});
  state.apiFetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({id: "alice", email: "alice@example.com", is_library_public: false, email_verified: false})));
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
test("a real same-account verification refresh releases the pending controls", async () => {
  render(<AuthProvider><AccountSecurity /></AuthProvider>);
  const check = await screen.findByRole("button", {name: "Check verification status"});
  await waitFor(() => expect(check).toBeEnabled());
  fireEvent.click(check);
  expect(await screen.findByRole("status")).toHaveTextContent("Verification status updated");
  expect(screen.getByRole("button", {name: "Check verification status"})).toBeEnabled();
  expect(screen.getByRole("button", {name: "Delete account"})).toBeEnabled();
});
