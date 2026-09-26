import type { MenuStyleId } from "@cooking/shared";
import type { RecipeImageAccess, RecipeImageGeneration } from "./index";

const MENU_ARTWORK_DEADLINE_MS = 90_000;
const MENU_ARTWORK_POLL_MS = 2_000;

export type GenerateMenuArtworkPayload = {
  request_id: string;
  style_id: MenuStyleId;
  instructions: string;
};

export type MenuArtworkResult = RecipeImageGeneration;

export interface MenuArtworkClient {
  artworkAccess(options?: { signal?: AbortSignal }): Promise<RecipeImageAccess>;
  generateArtwork(
    payload: GenerateMenuArtworkPayload,
    options?: { signal?: AbortSignal },
  ): Promise<MenuArtworkResult>;
  artworkStatus(
    requestId: string,
    options?: { signal?: AbortSignal },
  ): Promise<MenuArtworkResult>;
  artworkFile(requestId: string, options?: { signal?: AbortSignal }): Promise<Response>;
}

type ApiErrorShape = { status?: unknown; code?: unknown };

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal, getAbortError: () => Error): void {
  if (signal.aborted) throw getAbortError();
}

function callWithAbort<T>(
  signal: AbortSignal,
  getAbortError: () => Error,
  call: () => Promise<T>,
): Promise<T> {
  throwIfAborted(signal, getAbortError);
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(getAbortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    let result: Promise<T>;
    try {
      result = call();
    } catch (error) {
      signal.removeEventListener("abort", abort);
      reject(error);
      return;
    }
    result.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function waitForPoll(signal: AbortSignal, getAbortError: () => Error): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(getAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, MENU_ARTWORK_POLL_MS);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as ApiErrorShape;
  return status === 404 || code === "not_found";
}

function isDefinitiveRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status } = error as ApiErrorShape;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408;
}

export async function resolveMenuArtwork(
  client: MenuArtworkClient,
  payload: GenerateMenuArtworkPayload,
  options: { mode: "generate" | "check"; signal: AbortSignal },
): Promise<MenuArtworkResult> {
  const originalPayload: GenerateMenuArtworkPayload = {
    request_id: payload.request_id,
    style_id: payload.style_id,
    instructions: payload.instructions,
  };
  const operation = new AbortController();
  let operationAbortError: Error | null = null;
  const getAbortError = () => operationAbortError ?? createAbortError("Request aborted");
  const abortOperation = (message: string) => {
    if (operation.signal.aborted) return;
    operationAbortError = createAbortError(message);
    operation.abort();
  };
  const abortFromCaller = () => abortOperation("Request aborted");
  if (options.signal.aborted) abortFromCaller();
  else options.signal.addEventListener("abort", abortFromCaller, { once: true });
  const deadline = setTimeout(
    () => abortOperation("Menu artwork request timed out"),
    MENU_ARTWORK_DEADLINE_MS,
  );
  const requestOptions = { signal: operation.signal };

  const submitOriginal = async (): Promise<MenuArtworkResult> => {
    throwIfAborted(operation.signal, getAbortError);
    try {
      return await callWithAbort(
        operation.signal,
        getAbortError,
        () => client.generateArtwork(originalPayload, requestOptions),
      );
    } catch (error) {
      if (operation.signal.aborted) throw getAbortError();
      if (isDefinitiveRejection(error)) throw error;
      return callWithAbort(
        operation.signal,
        getAbortError,
        () => client.artworkStatus(originalPayload.request_id, requestOptions),
      );
    }
  };

  try {
    throwIfAborted(operation.signal, getAbortError);
    let result: MenuArtworkResult;
    if (options.mode === "check") {
      try {
        result = await callWithAbort(
          operation.signal,
          getAbortError,
          () => client.artworkStatus(originalPayload.request_id, requestOptions),
        );
      } catch (error) {
        if (operation.signal.aborted) throw getAbortError();
        if (!isMissing(error)) throw error;
        result = await submitOriginal();
      }
    } else {
      result = await submitOriginal();
    }

    while (result.status === "pending") {
      await waitForPoll(operation.signal, getAbortError);
      result = await callWithAbort(
        operation.signal,
        getAbortError,
        () => client.artworkStatus(originalPayload.request_id, requestOptions),
      );
    }
    return result;
  } finally {
    clearTimeout(deadline);
    options.signal.removeEventListener("abort", abortFromCaller);
  }
}
