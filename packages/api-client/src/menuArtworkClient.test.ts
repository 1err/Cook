import { afterEach, describe, expect, test, vi } from "vitest";
import { createApiClient, type GenerateMenuArtworkPayload } from "./index";

const payload: GenerateMenuArtworkPayload = {
  request_id: "menu/request 1",
  style_id: "cozy-cafe",
  instructions: "Tiny tomatoes",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("menu artwork API client", () => {
  test("uses cookie credentials and propagates the abort signal for access and generation", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      request_id: payload.request_id,
      status: "completed",
      file_url: "/menus/artwork/file",
    })));
    vi.stubGlobal("fetch", fetcher);
    const client = createApiClient({ baseUrl: "https://api.example/", auth: { kind: "cookie" } });
    const signal = new AbortController().signal;

    await client.menus.artworkAccess({ signal });
    await client.menus.generateArtwork(payload, { signal });

    expect(fetcher.mock.calls[0]).toEqual([
      "https://api.example/menus/artwork/access",
      expect.objectContaining({ credentials: "include", signal }),
    ]);
    expect(fetcher.mock.calls[1]).toEqual([
      "https://api.example/menus/artwork",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify(payload),
        signal,
      }),
    ]);
  });

  test("omits cookies, adds native bearer auth, and URL-encodes status and file request IDs", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: payload.request_id,
      status: "completed",
      file_url: "/menus/artwork/file",
    })));
    vi.stubGlobal("fetch", fetcher);
    const client = createApiClient({
      baseUrl: "https://api.example",
      auth: { kind: "bearer", getToken: () => "native-token" },
    });
    const signal = new AbortController().signal;

    await client.menus.artworkStatus("request / id", { signal });
    await client.menus.artworkFile("request / id", { signal });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example/menus/artwork/request%20%2F%20id",
      "https://api.example/menus/artwork/request%20%2F%20id/file",
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.credentials).toBe("omit");
      expect(init.headers.get("Authorization")).toBe("Bearer native-token");
      expect(init.signal).toBe(signal);
    }
  });

  test("returns the untouched binary artwork response", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const response = new Response(bytes, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const client = createApiClient({ baseUrl: "https://api.example", auth: { kind: "cookie" } });

    const result = await client.menus.artworkFile(payload.request_id);

    expect(result).toBe(response);
    expect(result.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
  });

  test("ignores a late 401 from an older auth generation", async () => {
    let authGeneration = 4;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      finish = resolve;
    })));
    const onUnauthorized = vi.fn();
    const client = createApiClient({
      baseUrl: "https://api.example",
      auth: { kind: "bearer", getToken: () => "native-token" },
      getAuthGeneration: () => authGeneration,
      onUnauthorized,
    });

    const request = client.menus.artworkStatus(payload.request_id);
    authGeneration += 1;
    finish(new Response(JSON.stringify({ detail: "Expired" }), { status: 401 }));

    await expect(request).rejects.toEqual(expect.objectContaining({ status: 401 }));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
