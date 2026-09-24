/* Incoming shares only. This worker deliberately does not cache pages or API responses. */
"use strict";

const SHARE_DB = "chefworld-pending-shares-v1";
const SHARE_STORE = "shares";
const SHARE_TTL = 15 * 60 * 1000;
const MAX_VIDEO_BYTES = 14 * 1024 * 1024;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_PENDING_BYTES = 60 * 1024 * 1024;
const MAX_PENDING_SHARES = 3;
const SHARE_ID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  self.clients.claim(),
  transactShares(() => undefined).catch(() => undefined),
])));

function shareError(code) {
  const error = new Error(code);
  error.shareCode = code;
  return error;
}

function redirectToImport(key, value) {
  const url = new URL("/import", self.location.origin);
  url.searchParams.set(key, value);
  return Response.redirect(url.href, 303);
}

// Read/write operations share one atomic transaction, including expiry and eviction.
function transactShares(operation) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
    request.onerror = () => reject(shareError("storage"));
    request.onblocked = () => reject(shareError("storage"));
    request.onsuccess = () => {
      const db = request.result;
      let result;
      let tx;
      try {
        tx = db.transaction(SHARE_STORE, "readwrite");
        const store = tx.objectStore(SHARE_STORE);
        const all = store.getAll();
        all.onsuccess = () => {
          try {
            const now = Date.now();
            const retained = [];
            for (const row of all.result) {
              if (now - row.createdAt >= SHARE_TTL || row.createdAt > now || !Number.isFinite(row.bytes)) {
                store.delete(row.id);
              } else retained.push(row);
            }
            result = operation(store, retained);
          } catch (error) {
            reject(error);
            tx.abort();
          }
        };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(shareError("storage")); };
      } catch (error) {
        db.close();
        reject(shareError("storage"));
      }
    };
  });
}

async function boundedFormData(request) {
  const type = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(type) || !request.body) throw shareError("invalid");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw shareError("too-large");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw shareError("too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), { headers: { "content-type": type } }).formData();
  } catch {
    throw shareError("invalid");
  }
}

function parseShare(form) {
  const limits = { title: 1000, text: 20000, url: 8000 };
  const fields = { title: "", text: "", url: "" };
  const seen = new Set();
  let video = null;
  for (const [name, value] of form) {
    if (name === "video") {
      if (!(value instanceof File) || video || value.size === 0) throw shareError("invalid");
      if (value.size > MAX_VIDEO_BYTES) throw shareError("too-large");
      const extension = /\.([a-z0-9]+)$/i.exec(value.name)?.[1]?.toLowerCase();
      const expected = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
      if (!extension || !Object.hasOwn(expected, extension)) throw shareError("invalid");
      if (value.type && value.type !== expected[extension] && value.type !== "application/octet-stream") throw shareError("invalid");
      if (/[\\/\u0000-\u001f\u007f]/.test(value.name) || value.name.length > 200) throw shareError("invalid");
      // Some Android providers send a generic MIME for an otherwise supported
      // file. Keep the bytes, and supply the known type to the upload endpoint;
      // the backend still validates the actual container signature.
      video = new File([value], value.name, { type: expected[extension], lastModified: value.lastModified });
    } else {
      if (!Object.hasOwn(limits, name) || typeof value !== "string" || value.length > limits[name] || seen.has(name)) throw shareError("invalid");
      seen.add(name);
      fields[name] = value.trim();
    }
  }
  if (!video && !fields.title && !fields.text && !fields.url) throw shareError("invalid");
  return { id: crypto.randomUUID(), createdAt: Date.now(), ...fields, video,
    bytes: (video?.size || 0) + new TextEncoder().encode(JSON.stringify(fields)).byteLength };
}

async function receiveShare(request) {
  try {
    const share = parseShare(await boundedFormData(request));
    await transactShares((store, retained) => {
      const oldest = retained.sort((a, b) => a.createdAt - b.createdAt);
      let bytes = oldest.reduce((sum, row) => sum + row.bytes, 0);
      while (oldest.length >= MAX_PENDING_SHARES || bytes + share.bytes > MAX_PENDING_BYTES) {
        const row = oldest.shift();
        if (!row) throw shareError("storage");
        bytes -= row.bytes;
        store.delete(row.id);
      }
      store.put(share);
    });
    return redirectToImport("share", share.id);
  } catch (error) {
    return redirectToImport("shareError", error.shareCode || "storage");
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(receiveShare(event.request));
  }
});

async function respondToMessage(event, port) {
  try {
    const source = event.source;
    if (!source || source.type !== "window" || new URL(source.url).origin !== self.location.origin) throw shareError("invalid");
    const client = await self.clients.get(source.id);
    if (!client || client.type !== "window" || new URL(client.url).origin !== self.location.origin) throw shareError("invalid");
    const { type, id, ownerId } = event.data || {};
    if (!SHARE_ID.test(id) || !["chefworld:get-share", "chefworld:delete-share"].includes(type)) throw shareError("invalid");
    if (typeof ownerId !== "string" || !ownerId || ownerId.length > 128 || ownerId.trim() !== ownerId || /[\u0000-\u001f\u007f]/.test(ownerId)) throw shareError("invalid");
    const result = await transactShares((store, retained) => {
      const row = retained.find((item) => item.id === id);
      // The authenticated page supplies its verified account ID. Claim once so
      // navigating browser history after switching accounts cannot hydrate it.
      if (row && row.ownerId !== undefined && row.ownerId !== ownerId) return { ok: false, error: "expired" };
      if (type === "chefworld:delete-share") {
        store.delete(id);
        return { ok: true };
      }
      if (!row) return { ok: false, error: "expired" };
      if (row.ownerId === undefined) store.put({ ...row, ownerId });
      const { bytes, ownerId: claimedOwner, ...share } = row;
      return { ok: true, share };
    });
    port.postMessage(result);
  } catch (error) {
    port.postMessage({ ok: false, error: error.shareCode || "storage" });
  }
}

self.addEventListener("message", (event) => {
  if (event.ports?.[0]) event.waitUntil(respondToMessage(event, event.ports[0]));
});
