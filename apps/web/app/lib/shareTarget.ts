export type SharedRecipeSource = {
  id: string;
  createdAt: number;
  title: string;
  text: string;
  url: string;
  video: File | null;
};

let registration: Promise<ServiceWorkerRegistration> | undefined;

export function registerShareTarget(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.reject(new Error("Direct sharing is not supported in this browser. Paste a link or choose a video."));
  }
  if (!registration) {
    registration = navigator.serviceWorker.register("/chefworld-share-sw.js", { scope: "/" }).catch((error) => {
      registration = undefined;
      throw error;
    });
  }
  return registration;
}

async function requestShare<T>(type: string, id: string, ownerId: string): Promise<T> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("This shared item is invalid. Share it to Chef World again.");
  if (!ownerId || ownerId.length > 128) throw new Error("Sign in before opening this shared item.");
  return new Promise<T>((resolve, reject) => {
    let channel: MessageChannel | undefined;
    let finished = false;
    const timer = window.setTimeout(() => finish(new Error("Couldn't open this shared item. Try sharing it again.")), 10_000);
    function finish(error?: Error, value?: T) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      channel?.port1.close();
      channel?.port2.close();
      if (error) reject(error); else resolve(value as T);
    }
    void (async () => {
      await registerShareTarget();
      const active = (await navigator.serviceWorker.ready).active;
      if (finished) return;
      if (!active) throw new Error("Direct sharing isn't ready yet. Reopen Chef World and try again.");
      channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.ok !== true) {
          finish(new Error(shareErrorMessage(typeof event.data?.error === "string" ? event.data.error : "expired")));
          return;
        }
        finish(undefined, event.data.share as T);
      };
      channel.port1.onmessageerror = () => finish(new Error("Couldn't read this shared item. Share it again."));
      active.postMessage({ type, id, ownerId }, [channel.port2]);
    })().catch((error) => finish(error instanceof Error ? error : new Error("Direct sharing is unavailable.")));
  });
}

export async function readSharedRecipe(id: string, ownerId: string): Promise<SharedRecipeSource> {
  const share = await requestShare<SharedRecipeSource>("chefworld:get-share", id, ownerId);
  if (!share || share.id !== id || typeof share.text !== "string" || typeof share.url !== "string"
      || typeof share.title !== "string" || (share.video !== null && !(share.video instanceof File))) {
    throw new Error("Couldn't read this shared item. Share it to Chef World again.");
  }
  return share;
}

export function deleteSharedRecipe(id: string, ownerId: string): Promise<void> {
  return requestShare<void>("chefworld:delete-share", id, ownerId);
}

export function sharedRecipeText(share: Pick<SharedRecipeSource, "title" | "text" | "url">): string {
  // Android frequently puts a shared URL in text or title, not the URL field.
  return Array.from(new Set([share.url, share.text, share.title].map((value) => value.trim()).filter(Boolean))).join("\n");
}

export function shareErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    "too-large": "Shared videos must be 14 MB or smaller.",
    invalid: "Share one MP4, MOV, or WebM video, or a recipe link.",
    storage: "Your browser couldn't keep the shared item. Free some browser storage and share it again.",
    expired: "This shared item has expired. Share it to Chef World again.",
  };
  return messages[code] ?? "Couldn't receive this shared item. Please try sharing it again.";
}
