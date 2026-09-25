import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MESSAGE_MAP } from "@cooking/shared";
import ImportPage from "./page";

const mocks = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, loading: false },
  read: vi.fn(), remove: vi.fn(), media: vi.fn(), link: vi.fn(), push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../lib/auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("../components/RequireAuth", () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../lib/api", () => ({ webApiClient: { recipes: {
  importCapabilities: async () => ({ media_upload: true, video_analysis: true, max_media_bytes: 30 * 1024 * 1024 }),
  createMediaImportJob: mocks.media, createImportJob: mocks.link, cancelImportJob: vi.fn(),
} } }));
vi.mock("../lib/editorialCopy", () => ({ useEditorialCopy: () => ({ "import.tagline": "Import recipes" }) }));
vi.mock("../lib/i18n", () => ({ useT: () => (key: string) => MESSAGE_MAP.en[key] || key }));
vi.mock("../lib/shareTarget", async (original) => ({
  ...await original<typeof import("../lib/shareTarget")>(),
  readSharedRecipe: mocks.read, deleteSharedRecipe: mocks.remove,
}));
const id = "33888241-5c9f-4c61-a797-1c4e7a970e05";
const source = "https://www.xiaohongshu.com/explore/69eaf618000000001a035987?xsec_token=keep";
const video = new File(["shared video bytes"], "排骨.mp4", { type: "video/mp4" });
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.user = { id: "user-1" }; mocks.auth.loading = false;
  mocks.remove.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue({ id, createdAt: Date.now(), title: "Creator post", text: `分享 ${source}`, url: "", video });
  mocks.media.mockResolvedValue({ id: "job", status: "failed", error: { message: "Try again" } });
  mocks.link.mockResolvedValue({ id: "job", status: "failed", error: { message: "Try again" } });
  window.history.replaceState({}, "", `/import?share=${id}`);
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/import"); });
it("waits for authentication before claiming shared media without auto extraction", async () => {
  mocks.auth.user = null;
  const view = render(<ImportPage />); expect(mocks.read).not.toHaveBeenCalled();
  mocks.auth.user = { id: "user-1" }; view.rerender(<ImportPage />);
  await screen.findByText(/Shared video ready/);
  expect(mocks.read).toHaveBeenCalledWith(id, "user-1");
  expect(mocks.media).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it("submits the shared File to the async media job and retains it on failure", async () => {
  render(<ImportPage />); await screen.findByText(/Shared video ready/);
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  const form = mocks.media.mock.calls[0][0];
  expect(form.get("file")).toBe(video); expect(form.get("source_url")).toBe(source);
  expect(form.get("title")).toBe(""); expect(mocks.remove).not.toHaveBeenCalled();
});
it("uses Android title-field links without overriding the dish title", async () => {
  mocks.read.mockResolvedValue({ id, createdAt: Date.now(), title: source, text: "", url: "", video: null });
  render(<ImportPage />);
  await waitFor(() => expect(screen.getByLabelText("YouTube, TikTok, or RedNote URL")).toHaveValue(source));
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" })); await screen.findByRole("alert");
  expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ mode: "link", url: source, title: undefined }));
});
it("discards without an API call and removes the navigation reference", async () => {
  render(<ImportPage />); await screen.findByText(/Shared video ready/);
  fireEvent.click(screen.getByRole("button", { name: "Discard shared item" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(id, "user-1"));
  expect(window.location.search).toBe(""); expect(mocks.media).not.toHaveBeenCalled();
});
it("keeps expired shares out of the importer", async () => {
  mocks.read.mockRejectedValue(new Error("This shared item has expired. Share it again."));
  render(<ImportPage />); expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(mocks.media).not.toHaveBeenCalled();
});

it.each([
  "https://www.youtube.com/watch?v=A6bByqI_TH8",
  "https://vm.tiktok.com/ZMrecipe/",
  "https://www.xiaohongshu.com/explore/69eaf618000000001a035987?xsec_token=keep",
])("extracts the URL from pasted share text before queuing %s", async url => {
  window.history.replaceState({}, "", "/import");
  render(<ImportPage />);
  fireEvent.change(screen.getByLabelText("YouTube, TikTok, or RedNote URL"), { target: { value: `Try this recipe ${url}` } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
  await screen.findByRole("alert");
  expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ url, mode: "link" }));
});
