import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportPage from "./page";

const { mockApiFetch, mockPush } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({ apiFetch: mockApiFetch }));
vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => key,
}));

beforeEach(() => {
  mockPush.mockReset();
  mockApiFetch.mockReset().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: "TikTok only exposed an attribution caption." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(cleanup);

describe("ImportPage source errors", () => {
  it("renders backend detail and clears the stale error on source edits and mode changes", async () => {
    const user = userEvent.setup();
    render(<ImportPage />);

    const url = screen.getByLabelText("YouTube or TikTok URL");
    await user.type(url, "https://vm.tiktok.com/ZMrecipe/");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TikTok only exposed an attribution caption.",
    );

    await user.type(url, "x");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TikTok only exposed an attribution caption.",
    );

    await user.click(screen.getByRole("tab", { name: "Paste recipe text" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
