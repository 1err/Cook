import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CostsPanel } from "./CostsPanel";
import { emptyCostReport, exampleCostReport } from "./costFixtures";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiFetch: request }));
beforeEach(() => { request.mockReset(); });
afterEach(cleanup);

test("failed cost reports show unavailable instead of fabricated zero spend and allow retry", async () => {
  request.mockResolvedValue({ ok: false, status: 503 });
  const user = userEvent.setup();
  render(<CostsPanel />);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
  expect(screen.queryByText(/^\$0/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry cost report" }));
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledWith("/admin/ai-costs", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
});

test("provider billing links remain accessible when the report is unavailable", async () => {
  request.mockResolvedValue({ ok: false, status: 503 });
  render(<CostsPanel />);
  await screen.findByRole("alert");
  expect(screen.getByRole("link", { name: "OpenAI usage" })).toHaveAttribute("href", "https://platform.openai.com/usage");
  expect(screen.getByRole("link", { name: "OpenAI billing" })).toHaveAttribute("href", "https://platform.openai.com/settings/organization/billing/overview");
  expect(screen.getByRole("link", { name: "Gemini usage & billing" })).toHaveAttribute("href", "https://aistudio.google.com/usage");
  expect(screen.getByText(/Video analysis through Gemini is billed by Google/)).toBeVisible();
  expect(screen.getByRole("link", { name: "AWS billing" })).toHaveAttribute("href", "https://console.aws.amazon.com/billing/home");
  expect(screen.getByRole("link", { name: "Vercel usage & billing" })).toHaveAttribute("href", "https://vercel.com/dashboard/usage");
});

test("shows partial AI estimates separately from reservations, unknown charges and hosting", async () => {
  request.mockResolvedValue({ ok: true, json: async () => exampleCostReport });
  render(<CostsPanel />);
  const estimate = await screen.findByLabelText("Recorded AI estimate");
  expect(estimate).toHaveTextContent("$1.252");
  expect(screen.getByLabelText("Reserved budget")).toHaveTextContent("$2.40");
  expect(screen.getByLabelText("Uncertain reservations")).toHaveTextContent("$1.20");
  expect(screen.getByText(/2 calls have no priced result/)).toBeVisible();
  expect(screen.getByText(/Partial history/)).toBeVisible();
  expect(screen.getByText(/AWS and Vercel hosting are not included/)).toBeVisible();
  const table = screen.getByRole("table", { name: "AI provider cost breakdown" });
  expect(within(table).getByText("OpenAI images")).toBeVisible();
  expect(within(table).getByText("OpenAI text")).toBeVisible();
  expect(within(table).getByText("Gemini video")).toBeVisible();
  expect(within(table).getByText("gpt-image-1.5")).toBeVisible();
  expect(screen.getByText("100/day for admins · 3/day for other accounts")).toBeVisible();
});

test("empty recorded usage does not imply a complete zero bill or invented history", async () => {
  request.mockResolvedValue({ ok: true, json: async () => emptyCostReport });
  render(<CostsPanel />);
  expect(await screen.findByText("No AI calls recorded this month.")).toBeVisible();
  expect(screen.getByText(/No ledger records yet/)).toBeVisible();
  expect(screen.getByLabelText("Recorded AI estimate")).toHaveTextContent("$0.00");
  expect(screen.getByText(/Partial history/)).toBeVisible();
});

test("a failed refresh removes stale money figures instead of presenting them as current", async () => {
  request.mockResolvedValueOnce({ ok: true, json: async () => exampleCostReport }).mockResolvedValueOnce({ ok: false, status: 503 });
  const { rerender } = render(<CostsPanel refreshToken={0} />);
  await screen.findByLabelText("Recorded AI estimate");
  rerender(<CostsPanel refreshToken={1} />);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Recorded AI estimate")).not.toBeInTheDocument();
});

test("a late response from an old refresh cannot replace a newer report", async () => {
  let resolveOld!: (value: unknown) => void;
  request.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce({ ok: true, json: async () => emptyCostReport });
  const { rerender } = render(<CostsPanel refreshToken={0} />);
  const oldSignal = request.mock.calls[0][1].signal;
  rerender(<CostsPanel refreshToken={1} />);
  expect(await screen.findByText("No AI calls recorded this month.")).toBeVisible();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { resolveOld({ ok: true, json: async () => exampleCostReport }); });
  expect(screen.getByLabelText("Recorded AI estimate")).toHaveTextContent("$0.00");
});
