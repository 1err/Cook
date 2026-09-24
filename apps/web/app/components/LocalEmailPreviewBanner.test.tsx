import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LocalEmailPreviewBanner } from "./LocalEmailPreviewBanner";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

test.each([undefined, "0", "true"])("does not expose a preview notice without the explicit flag (%s)", (flag) => {
  vi.stubEnv("NEXT_PUBLIC_LOCAL_EMAIL_PREVIEW", flag);
  vi.stubEnv("NEXT_PUBLIC_API_BASE", "http://127.0.0.1:8455");
  const { container } = render(<LocalEmailPreviewBanner />);
  expect(container).toBeEmptyDOMElement();
});

test.each([
  ["http://127.0.0.1:8455", "http://127.0.0.1:8455/__preview/inbox"],
  ["http://localhost:8455/", "http://localhost:8455/__preview/inbox"],
  ["http://[::1]:8455", "http://[::1]:8455/__preview/inbox"],
])("explains local email delivery and links to the configured loopback inbox (%s)", (apiBase, inbox) => {
  vi.stubEnv("NEXT_PUBLIC_LOCAL_EMAIL_PREVIEW", "1");
  vi.stubEnv("NEXT_PUBLIC_API_BASE", apiBase);
  render(<LocalEmailPreviewBanner />);
  expect(screen.getByRole("complementary", { name: "Local test environment" })).toHaveTextContent(
    "Local test environment. Accounts stay on this computer. Emails appear in the test inbox, not your real inbox.",
  );
  expect(screen.getByRole("link", { name: "Open test inbox" })).toHaveAttribute("href", inbox);
});

test.each([
  "https://api.chef-world.com",
  "http://localhost.example.com:8455",
  "http://127.0.0.1.example.com:8455",
  "http://192.168.1.10:8455",
  "ftp://localhost:8455",
  "http://preview:secret@localhost:8455",
  "not-a-url",
  "",
])("does not imply accounts are local for an unsafe or unavailable API address (%s)", (apiBase) => {
  vi.stubEnv("NEXT_PUBLIC_LOCAL_EMAIL_PREVIEW", "1");
  vi.stubEnv("NEXT_PUBLIC_API_BASE", apiBase);
  const { container } = render(<LocalEmailPreviewBanner />);
  expect(container).toBeEmptyDOMElement();
});
