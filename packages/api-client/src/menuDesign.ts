import type { MenuDesign } from "@cooking/shared";

export type GenerateMenuDesignPayload = {
  menu_creation_id: string;
  brief: string;
  preferences?: Partial<Pick<MenuDesign, "layout" | "density" | "decorations">>;
  content: {
    item_count: number;
    section_count: number;
    photo_count: number;
    language: "en" | "zh";
  };
};

export interface MenuDesignClient {
  generateDesign(payload: GenerateMenuDesignPayload, options?: { signal?: AbortSignal }): Promise<MenuDesign>;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/** One explicit paid attempt. Ambiguous failures never trigger automatic replay. */
export async function resolveMenuDesign(
  client: MenuDesignClient,
  payload: GenerateMenuDesignPayload,
  options: { signal: AbortSignal },
): Promise<MenuDesign> {
  const snapshot = JSON.parse(JSON.stringify(payload)) as GenerateMenuDesignPayload;
  const operation = new AbortController();
  let failure = abortError("Request aborted");
  const abort = () => operation.abort();
  if (options.signal.aborted) abort();
  else options.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    failure = abortError("Menu design request timed out");
    operation.abort();
  }, 90_000);
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<MenuDesign>((resolve, reject) => {
      onAbort = () => reject(failure);
      if (operation.signal.aborted) { reject(failure); return; }
      operation.signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve().then(() => {
        if (operation.signal.aborted) throw failure;
        return client.generateDesign(snapshot, { signal: operation.signal });
      }).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    if (onAbort) operation.signal.removeEventListener("abort", onAbort);
  }
}
