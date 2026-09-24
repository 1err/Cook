import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import Dashboard from "./Dashboard";
import { emptyOverview, exampleUser } from "./testFixtures";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiFetch: request }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test("renders real empty state, switches tabs and opens a user timeline", async () => {
  request.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () =>
      path.includes("/overview")
        ? emptyOverview
        : path.includes("/users/")
          ? { user: exampleUser, events: [] }
          : { items: [exampleUser], total: 1, limit: 25, offset: 0 },
  }));
  const user = userEvent.setup();
  render(<Dashboard />);
  expect(await screen.findByText("Your audience starts here")).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Users" }));
  await user.click(
    await screen.findByRole("button", { name: "owner@example.com" }),
  );
  expect(await screen.findByRole("dialog")).toBeVisible();
  expect(
    screen.getByText("No recorded activity in the tracked portion of this period."),
  ).toBeVisible();
});
test("failed reports display an error instead of fake metrics", async () => {
  request.mockResolvedValue({ ok: false, status: 503 });
  render(<Dashboard />);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
  expect(
    screen.queryByText("Your audience starts here"),
  ).not.toBeInTheDocument();
});

test("historic untracked activity is unavailable, and user search does not filter overview", async () => {
  request.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () => path.includes('/overview')
      ? { ...emptyOverview, coverage: { ...emptyOverview.coverage, unavailable: true } }
      : {items:[exampleUser], total:1, limit:25, offset:0},
  }));
  const user = userEvent.setup();
  render(<Dashboard />);
  expect(await screen.findByText(/Activity tracking is unavailable for this entire period/)).toBeVisible();
  await user.click(screen.getByRole('tab', {name:'Users'}));
  await user.type(screen.getByRole('searchbox'), 'owner');
  await vi.waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('q=owner&'))).toBe(true));
  request.mockClear();
  await user.click(screen.getByRole('tab', {name:'Overview'}));
  await vi.waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('q=&limit=25&offset=0'))).toBe(true));
});
