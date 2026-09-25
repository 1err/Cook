import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InfrastructureCosts } from "./InfrastructureCosts";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiFetch: request }));
beforeEach(() => { request.mockReset(); });
afterEach(cleanup);

test("shows fetched AWS account costs separately with their actual coverage and timestamp", async () => {
  request.mockResolvedValue({ ok: true, json: async () => ({ status: "available", provider: "aws", scope: "AWS account-wide; includes resources outside this app.", month_utc: "2026-09-01", through: "2026-09-24", fetched_at: "2026-09-25T00:00:00Z", estimated: true, currency: "USD", total_usd: "42.50", services: [{ service: "Elastic Compute Cloud", cost_usd: "42.50" }], unavailable_reason: null }) });
  render(<InfrastructureCosts />);
  expect(await screen.findByLabelText("AWS account estimate")).toHaveTextContent("$42.50");
  expect(screen.getByText(/AWS account-wide/)).toBeVisible();
  expect(screen.getByText(/Sep 24, 2026/)).toBeVisible();
  expect(screen.getByText("Elastic Compute Cloud")).toBeVisible();
  expect(screen.getByText(/Vercel costs are not connected/)).toBeVisible();
});

test.each(["network", "unavailable"])("keeps missing AWS %s totals unavailable instead of showing zero", async mode => {
  if (mode === "network") request.mockRejectedValue(new TypeError("Offline"));
  else request.mockResolvedValue({ ok: true, json: async () => ({ status: "unavailable", total_usd: null, services: [], unavailable_reason: "access_denied" }) });
  render(<InfrastructureCosts />);
  expect(await screen.findByText("AWS cost data is unavailable.")).toBeVisible();
  expect(screen.queryByLabelText("AWS account estimate")).not.toBeInTheDocument();
  expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open AWS billing" })).toHaveAttribute("href", "https://console.aws.amazon.com/billing/home");
});
