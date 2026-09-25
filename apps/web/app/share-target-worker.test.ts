// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

type Row = { id: string; createdAt: number; bytes: number; [key: string]: unknown };

// IndexedDB's asynchronous request/transaction contract, without a browser dependency.
function memoryIndexedDB(rows: Map<string, Row>) {
  return {
    open() {
      const open: any = {};
      queueMicrotask(() => {
        open.result = {
          createObjectStore() {}, close() {},
          transaction() {
            const tx: any = {};
            tx.objectStore = () => ({
              getAll() {
                const request: any = {};
                queueMicrotask(() => {
                  request.result = [...rows.values()];
                  request.onsuccess?.();
                  queueMicrotask(() => tx.oncomplete?.());
                });
                return request;
              },
              put(row: Row) { rows.set(row.id, row); },
              delete(id: string) { rows.delete(id); },
            });
            return tx;
          },
        };
        open.onupgradeneeded?.();
        open.onsuccess?.();
      });
      return open;
    },
  };
}

function worker({ failStorage = false } = {}) {
  const handlers: Record<string, (event: any) => void> = {};
  const rows = new Map<string, Row>();
  const source = readFileSync(new URL("../public/chefworld-share-sw.js", import.meta.url), "utf8");
  const client = { id: "window-1", type: "window", url: "https://chef-world.test/import" };
  const self = {
    location: { origin: "https://chef-world.test" },
    addEventListener(type: string, handler: (event: any) => void) { handlers[type] = handler; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, get: async (id: string) => id === client.id ? client : null },
  };
  const indexedDB = failStorage ? { open() { throw new Error("Storage disabled"); } } : memoryIndexedDB(rows);
  vm.runInNewContext(source, { self, indexedDB, URL, Response, Request, File, Blob, FormData, crypto: { randomUUID }, Date, TextEncoder });
  return {
    rows,
    async share(form: FormData, url = "https://chef-world.test/share-target", method = "POST") {
      let response: Promise<Response> | undefined;
      handlers.fetch({ request: new Request(url, { method, ...(method === "POST" ? { body: form } : {}) }), respondWith(value: Promise<Response>) { response = value; } });
      return response;
    },
    async raw(request: Request) {
      let response: Promise<Response> | undefined;
      handlers.fetch({ request, respondWith(value: Promise<Response>) { response = value; } });
      return response;
    },
    async message(type: string, id: string, sourceClient = client, ownerId: unknown = "test-user") {
      let result: any;
      let done: Promise<unknown> | undefined;
      handlers.message({ data: { type, id, ownerId }, source: sourceClient, ports: [{ postMessage(value: unknown) { result = value; } }], waitUntil(value: Promise<unknown>) { done = value; } });
      await done;
      return result;
    },
  };
}

function textShare(value = "小红书 https://xhslink.com/a/recipe") {
  const form = new FormData();
  form.set("text", value);
  return form;
}

function videoShare(bytes: number) {
  const form = new FormData();
  form.set("video", new File([new Uint8Array(bytes)], "video.mp4", { type: "video/mp4" }));
  return form;
}

describe("installed website share receiver", () => {
  it("keeps full share text locally and returns an opaque redirect until explicitly deleted", async () => {
    const app = worker();
    const response = await app.share(textShare());
    expect(response?.status).toBe(303);
    const location = new URL(response!.headers.get("location")!);
    expect(location.pathname).toBe("/import");
    const id = location.searchParams.get("share")!;
    expect(id).toMatch(/^[a-f\d-]{36}$/);
    expect(location.href).not.toContain("xhslink");
    const read = await app.message("chefworld:get-share", id);
    expect(read).toMatchObject({ ok: true, share: { text: "小红书 https://xhslink.com/a/recipe", video: null } });
    expect(app.rows.size).toBe(1);
    expect(await app.message("chefworld:delete-share", id)).toEqual({ ok: true });
    expect(await app.message("chefworld:get-share", id)).toEqual({ ok: false, error: "expired" });
  });

  it("preserves binary video data for the existing upload request", async () => {
    const app = worker();
    const form = textShare();
    form.set("video", new File([new Uint8Array([1, 2, 3])], "红烧排骨.mp4", { type: "video/mp4" }));
    const response = await app.share(form);
    const id = new URL(response!.headers.get("location")!).searchParams.get("share")!;
    const result = await app.message("chefworld:get-share", id);
    expect(result.share.video.name).toBe("红烧排骨.mp4");
    expect([...new Uint8Array(await result.share.video.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it.each(["", "application/octet-stream"])("normalizes generic shared video MIME %s for the media API", async (type) => {
    const app = worker(); const form = textShare();
    form.set("video", new File([new Uint8Array([1, 2, 3])], "recipe.mp4", { type }));
    const response = await app.share(form);
    const id = new URL(response!.headers.get("location")!).searchParams.get("share")!;
    const result = await app.message("chefworld:get-share", id);
    expect(result.share.video.type).toBe("video/mp4");
    expect([...new Uint8Array(await result.share.video.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("claims pending video for the first verified account and hides it after account switching", async () => {
    const app = worker();
    const form = textShare();
    form.set("video", new File(["private video"], "recipe.mp4", { type: "video/mp4" }));
    const response = await app.share(form);
    const id = new URL(response!.headers.get("location")!).searchParams.get("share")!;
    expect((await app.message("chefworld:get-share", id, undefined, "alice")).ok).toBe(true);
    expect(await app.message("chefworld:get-share", id, undefined, "bob")).toEqual({ ok: false, error: "expired" });
    expect(await app.message("chefworld:delete-share", id, undefined, "bob")).toEqual({ ok: false, error: "expired" });
    expect((await app.message("chefworld:get-share", id, undefined, "alice")).share.video.name).toBe("recipe.mp4");
    expect(await app.message("chefworld:delete-share", id, undefined, "alice")).toEqual({ ok: true });
    expect(app.rows.size).toBe(0);
  });

  it.each([null, "", " ", "a".repeat(129), 42])("requires a valid account id for reading and deleting: %s", async (ownerId) => {
    const app = worker();
    const response = await app.share(textShare());
    const id = new URL(response!.headers.get("location")!).searchParams.get("share")!;
    for (const type of ["chefworld:get-share", "chefworld:delete-share"]) {
      expect(await app.message(type, id, undefined, ownerId)).toEqual({ ok: false, error: "invalid" });
    }
    expect(app.rows.size).toBe(1);
  });

  it("allows a verified account to discard an unclaimed share", async () => {
    const app = worker();
    const response = await app.share(textShare());
    const id = new URL(response!.headers.get("location")!).searchParams.get("share")!;
    expect(await app.message("chefworld:delete-share", id, undefined, "alice")).toEqual({ ok: true });
    expect(app.rows.size).toBe(0);
  });

  it("does not intercept any ordinary page, API request, cross-origin request, or GET", async () => {
    const app = worker();
    for (const [url, method] of [["https://chef-world.test/recipes/parse/video", "POST"], ["https://chef-world.test/share-target", "GET"], ["https://other.test/share-target", "POST"], ["https://chef-world.test/share-target/other", "POST"]]) {
      expect(await app.share(textShare(), url, method)).toBeUndefined();
    }
  });

  it.each([
    ["empty", () => new FormData()],
    ["too much text", () => textShare("a".repeat(40000))],
    ["unsupported video", () => { const f = textShare(); f.set("video", new File(["bad"], "unsafe.exe", { type: "video/mp4" })); return f; }],
    ["MIME mismatch", () => { const f = textShare(); f.set("video", new File(["bad"], "video.mp4", { type: "text/html" })); return f; }],
    ["empty video", () => { const f = textShare(); f.set("video", new File([], "video.mp4", { type: "video/mp4" })); return f; }],
    ["multiple videos", () => { const f = textShare(); f.append("video", new File(["1"], "1.mp4")); f.append("video", new File(["2"], "2.mp4")); return f; }],
    ["duplicate text fields", () => { const f = textShare(); f.append("title", ""); f.append("title", "other"); return f; }],
  ])("rejects %s without storing payload", async (_, makeForm) => {
    const app = worker();
    const response = await app.share(makeForm());
    expect(response!.headers.get("location")).toContain("shareError=invalid");
    expect(app.rows.size).toBe(0);
  });

  it("rejects declared oversized body before consuming it", async () => {
    const app = worker();
    const response = await app.raw(new Request("https://chef-world.test/share-target", { method: "POST", headers: { "Content-Length": String(31 * 1024 * 1024 + 1), "Content-Type": "multipart/form-data; boundary=x" }, body: "ignored" }));
    expect(response!.headers.get("location")).toContain("shareError=too-large");
    expect(app.rows.size).toBe(0);
  });

  it("rejects streamed oversized body when no Content-Length is supplied", async () => {
    const app = worker();
    const response = await app.raw(new Request("https://chef-world.test/share-target", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x" }, body: new Uint8Array(31 * 1024 * 1024 + 1) }));
    expect(response!.headers.get("location")).toContain("shareError=too-large");
    expect(app.rows.size).toBe(0);
  });

  it("expires old shares and limits retained records", async () => {
    const app = worker();
    const expiredId = randomUUID();
    app.rows.set(expiredId, { id: expiredId, createdAt: Date.now() - 16 * 60_000, bytes: 1 });
    expect(await app.message("chefworld:get-share", expiredId)).toEqual({ ok: false, error: "expired" });
    for (let i = 0; i < 5; i++) await app.share(textShare(String(i)));
    expect(app.rows.size).toBe(3);
    expect(app.rows.has(expiredId)).toBe(false);
  });

  it("bounds aggregate retained bytes by removing oldest pending shares", async () => {
    const app = worker();
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      app.rows.set(id, { id, createdAt: Date.now() - i * 1000, bytes: 30 * 1024 * 1024 });
    }
    await app.share(textShare());
    expect([...app.rows.values()].reduce((sum, row) => sum + row.bytes, 0)).toBeLessThanOrEqual(60 * 1024 * 1024);
  });

  it("rejects read access from non-window and foreign-origin callers", async () => {
    const app = worker();
    const response = await app.share(textShare());
    const id = new URL(response!.headers.get("location")!).searchParams.get("share")!;
    for (const source of [{ id: "window-1", type: "worker", url: "https://chef-world.test/import" }, { id: "window-1", type: "window", url: "https://other.test/import" }, { id: "unrecognized", type: "window", url: "https://chef-world.test/import" }]) {
      expect(await app.message("chefworld:get-share", id, source)).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("reports storage denial without falling through to a server upload", async () => {
    const app = worker({ failStorage: true });
    const response = await app.share(textShare());
    expect(response!.status).toBe(303);
    expect(response!.headers.get("location")).toContain("shareError=storage");
    expect(app.rows.size).toBe(0);
  });

  it("accepts exact 30MiB videos and evicts the oldest when file plus metadata exceeds the 60MiB budget", async () => {
    const app = worker();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await app.share(videoShare(30 * 1024 * 1024));
      const location = new URL(response!.headers.get("location")!);
      expect(location.searchParams.has("shareError")).toBe(false);
      const id = location.searchParams.get("share")!;
      ids.push(id);
      const result = await app.message("chefworld:get-share", id);
      expect(result.share.video.size).toBe(30 * 1024 * 1024);
    }
    expect(app.rows.has(ids[0])).toBe(false);
    expect(app.rows.has(ids[1])).toBe(true);
    expect(app.rows.size).toBe(1);
    expect([...app.rows.values()].reduce((sum, row) => sum + row.bytes, 0)).toBeGreaterThan(30 * 1024 * 1024);

    await app.share(videoShare(1));
    expect(app.rows.has(ids[1])).toBe(true);
    expect(app.rows.size).toBe(2);
    expect([...app.rows.values()].reduce((sum, row) => sum + row.bytes, 0)).toBeLessThanOrEqual(60 * 1024 * 1024);
  });

  it("rejects a 30MiB+1 file even when multipart body remains within transport bound", async () => {
    const app = worker();
    const response = await app.share(videoShare(30 * 1024 * 1024 + 1));
    expect(response!.headers.get("location")).toContain("shareError=too-large");
    expect(app.rows.size).toBe(0);
  });
});
