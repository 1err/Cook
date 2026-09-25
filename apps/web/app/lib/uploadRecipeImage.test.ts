import { afterEach, expect, test, vi } from "vitest";
import { uploadRecipeImage } from "./uploadRecipeImage";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("sends the original image through the authenticated upload and uses its stored URL", async () => {
  const file = new File(["image"], "cover.png", { type: "image/png" });
  apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ upload_url: "", file_url: "https://images.example/cover.png" })));
  expect(await uploadRecipeImage(file, "Upload failed")).toBe("https://images.example/cover.png");
  expect(apiFetch).toHaveBeenCalledWith("/recipes/upload-image", { method: "POST", body: expect.any(FormData) });
  expect(apiFetch.mock.calls.at(-1)![1].body.get("file")).toBe(file);
});

test("does not accept a failed storage PUT as a successful cover upload", async () => {
  apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ upload_url: "https://images.example/upload", file_url: "https://images.example/cover.png" })));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
  await expect(uploadRecipeImage(new File(["image"], "cover.png", { type: "image/png" }), "Upload failed")).rejects.toThrow("Upload failed");
});

test("does not erase a cover when the upload response is missing its stored URL", async () => {
  apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ upload_url: "" })));
  await expect(uploadRecipeImage(new File(["image"], "cover.png", { type: "image/png" }), "Upload failed")).rejects.toThrow("Upload failed");
});
