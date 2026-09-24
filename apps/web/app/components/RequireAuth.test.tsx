import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RequireAuth } from "./RequireAuth";

const state = vi.hoisted(() => ({
  replace: vi.fn(),
  user: { id: "new-user", email_verification_required: true, email_verified: false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
afterEach(cleanup);
beforeEach(() => {
  state.replace.mockClear();
  state.user = { id: "new-user", email_verification_required: true, email_verified: false };
  window.history.replaceState({}, "", "/import?from=%2Flibrary");
});

test("pending new accounts cannot mount protected app content and retain their intended destination", async () => {
  render(<RequireAuth><p>Private recipe editor</p></RequireAuth>);
  expect(screen.queryByText("Private recipe editor")).not.toBeInTheDocument();
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/check-email?redirect=%2Fimport%3Ffrom%3D%252Flibrary"));
});

test.each([{ required: false, verified: false }, { required: true, verified: true }])("existing or verified accounts can use the app: %o", ({ required, verified }) => {
  state.user.email_verification_required = required;
  state.user.email_verified = verified;
  render(<RequireAuth><p>Private recipe editor</p></RequireAuth>);
  expect(screen.getByText("Private recipe editor")).toBeInTheDocument();
  expect(state.replace).not.toHaveBeenCalled();
});
