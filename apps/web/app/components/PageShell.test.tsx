import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader, PageShell } from "./PageShell";

describe("PageShell", () => {
  it("gives pages one aligned main landmark without adding subtitle copy", () => {
    render(
      <PageShell>
        <PageHeader title="Recipes" actions={<button type="button">Filter</button>} />
      </PageShell>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("data-page-shell", "default");
    expect(screen.getByRole("heading", { name: "Recipes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Filter" })).toBeVisible();
    expect(screen.queryByTestId("page-subtitle")).not.toBeInTheDocument();
  });

  it("supports a narrow content measure inside the same shell contract", () => {
    const view = render(<PageShell size="narrow">Account form</PageShell>);

    expect(view.container.querySelector("main")).toHaveAttribute("data-page-shell", "narrow");
  });
});
