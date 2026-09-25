import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StepEvidence } from "./StepEvidence";
vi.mock("../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string) => MESSAGE_MAP.en[key] || key };
});
afterEach(cleanup);
test("shows only a compact source link for a verified source moment", () => {
  render(<StepEvidence step={{ text: "Cut tofu", instruction_source: "source", source_start_seconds: 12.8 }} sourceUrl="https://youtu.be/A6bByqI_TH8" />);
  expect(screen.queryByText("From source")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=A6bByqI_TH8&t=12s");
  expect(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
});
test("omits provenance labels and empty evidence panels from recipe details", () => {
  const { container, rerender } = render(<StepEvidence step={{ text: "Cut tofu", instruction_source: "user", source_start_seconds: 12 }} sourceUrl="https://youtu.be/A6bByqI_TH8" />);
  expect(container).toBeEmptyDOMElement();
  rerender(<StepEvidence step={{ text: "Cut tofu", instruction_source: "suggested", source_start_seconds: 12 }} sourceUrl="https://youtu.be/A6bByqI_TH8" />);
  expect(container).toBeEmptyDOMElement();
  rerender(<StepEvidence step={{ text: "Cut tofu", instruction_source: "source" }} sourceUrl="https://youtu.be/A6bByqI_TH8" />);
  expect(container).toBeEmptyDOMElement();
});
test("retains a suggested-step reminder only when editing and never links stale source moments", () => {
  render(<StepEvidence step={{ text: "Cut tofu", instruction_source: "suggested", source_start_seconds: 12 }} sourceUrl="https://youtu.be/A6bByqI_TH8" showSuggestedWarning />);
  expect(screen.getByText("Suggested step — review before cooking")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
test.each([
  ["javascript:alert(1)", 12],
  ["https://youtu.be/A6bByqI_TH8", -1],
  ["https://youtu.be/A6bByqI_TH8", Number.NaN],
])("does not render source links for unsupported URLs or invalid timestamps", (sourceUrl, seconds) => {
  const { container } = render(<StepEvidence step={{ text: "Cut tofu", instruction_source: "source", source_start_seconds: seconds as number }} sourceUrl={sourceUrl as string} />);
  expect(container).toBeEmptyDOMElement();
});
