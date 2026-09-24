import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StepEvidence } from "./StepEvidence";
vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string) => MESSAGE_MAP.en[key] || key };
});
afterEach(cleanup);
test("shows source attribution and a safe timestamp link", () => {
  render(<StepEvidence step={{ text: "Cut tofu", instruction_source: "source", source_start_seconds: 12.8 }} sourceUrl="https://youtu.be/A6bByqI_TH8" />);
  expect(screen.getByText("From source")).toBeVisible();
  expect(screen.getByRole("link")).toHaveAttribute("href", "https://www.youtube.com/watch?v=A6bByqI_TH8&t=12s");
  expect(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
});
test("does not link suggested or edited instructions to an old source moment", () => {
  const { rerender } = render(<StepEvidence step={{ text: "Cut tofu", instruction_source: "user", source_start_seconds: 12 }} sourceUrl="https://youtu.be/A6bByqI_TH8" />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  rerender(<StepEvidence step={{ text: "Cut tofu", instruction_source: "suggested", source_start_seconds: 12 }} sourceUrl="https://youtu.be/A6bByqI_TH8" />);
  expect(screen.getByText("Suggested step — review before cooking")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
