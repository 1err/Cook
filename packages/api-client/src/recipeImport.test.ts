import { afterEach, describe, expect, test, vi } from "vitest";
import { runRecipeImport } from "./recipeImport";
import { createApiClient } from "./index";
const recipe = { id: "draft", title: "Tofu", ingredients: [{ name: "tofu", quantity: "" }], steps: [] };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("recipe import jobs", () => {
  test("polls a partial recipe without discarding ingredients", async () => {
    const api = { getImportJob: vi.fn().mockResolvedValue({ id: "job", status: "completed", recipe }), cancelImportJob: vi.fn() };
    const result = await runRecipeImport(async () => ({ id: "job", status: "queued" }), api, new AbortController().signal, 1);
    expect(result).toEqual(recipe); expect(api.getImportJob).toHaveBeenCalledOnce(); expect(api.cancelImportJob).not.toHaveBeenCalled();
  });
  test("surfaces failed jobs without polling forever", async () => {
    const api = { getImportJob: vi.fn(), cancelImportJob: vi.fn() };
    await expect(runRecipeImport(async () => ({ id: "job", status: "failed", error: { code: "unavailable", message: "Try text instead." } }), api, new AbortController().signal)).rejects.toThrow("Try text instead.");
    expect(api.getImportJob).not.toHaveBeenCalled();
  });
  test("cancels the server job and stops polling when the caller aborts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const api = { getImportJob: vi.fn(), cancelImportJob: vi.fn().mockResolvedValue({ id: "job", status: "cancelled" }) };
    const pending = runRecipeImport(async () => ({ id: "job", status: "processing" }), api, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); controller.abort(); await rejected;
    await vi.runAllTimersAsync(); expect(api.cancelImportJob).toHaveBeenCalledExactlyOnceWith("job"); expect(api.getImportJob).not.toHaveBeenCalled();
  });
  test("cancels a late creation result without returning its recipe", async () => {
    const controller = new AbortController();
    let finish!: (job: any) => void;
    const api = { getImportJob: vi.fn(), cancelImportJob: vi.fn().mockResolvedValue({}) };
    const pending = runRecipeImport(() => new Promise(resolve => { finish = resolve; }), api, controller.signal);
    controller.abort(); finish({ id: "late", status: "queued" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(api.cancelImportJob).toHaveBeenCalledExactlyOnceWith("late");
  });
  test("keeps the original source URL in a text recovery request and uploads multipart", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: "job", status: "queued" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const api = createApiClient({ baseUrl: "https://api.test", auth: { kind: "cookie" } });
    await api.recipes.createImportJob({ mode: "text", url: "https://youtu.be/A6bByqI_TH8", transcript: "Stir tofu." });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ mode: "text", url: "https://youtu.be/A6bByqI_TH8" });
    const form = new FormData(); form.append("file", new Blob(["audio"]), "recipe.mp4");
    await api.recipes.createMediaImportJob(form);
    expect(fetcher.mock.calls[1][1].body).toBe(form); expect(fetcher.mock.calls[1][1].headers.has("Content-Type")).toBe(false);
  });
});
