import type { Recipe, RecipeImportJob } from "@cooking/shared";

type JobApi = {
  getImportJob: (id: string, signal?: AbortSignal) => Promise<RecipeImportJob>;
  cancelImportJob: (id: string) => Promise<RecipeImportJob>;
};

function aborted(): Error {
  const error = new Error("Import cancelled.");
  error.name = "AbortError";
  return error;
}

function pause(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const cancel = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, delay);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Bounded polling. Cancelled/unmounted requests never publish a late draft. */
export async function runRecipeImport(
  start: () => Promise<RecipeImportJob>,
  api: JobApi,
  signal: AbortSignal,
  pollMs = 1200,
): Promise<Recipe> {
  let job: RecipeImportJob | undefined;
  let cancelled = false;
  const cancel = () => {
    if (!job || cancelled || !["queued", "processing"].includes(job.status)) return;
    cancelled = true;
    void api.cancelImportJob(job.id).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel);
  try {
    if (signal.aborted) throw aborted();
    // Let creation return its ID even if cancelled during upload; then delete it.
    job = await start();
    const deadline = Date.now() + 10 * 60_000;
    while (true) {
      if (signal.aborted) { cancel(); throw aborted(); }
      if (job.status === "completed") {
        if (!job.recipe) throw new Error("The import returned no recipe. Please try again.");
        return job.recipe;
      }
      if (job.status === "failed") throw new Error(job.error?.message || "The import failed. Please try again.");
      if (job.status === "cancelled") throw aborted();
      if (Date.now() >= deadline) throw new Error("The import took too long. Please try again.");
      await pause(signal, pollMs);
      job = await api.getImportJob(job.id, signal);
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
