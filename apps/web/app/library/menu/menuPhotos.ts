import { webApiClient } from '../../lib/api';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const unavailable = () => new Error('Photo unavailable for menu export');
function cancelled() { return Object.assign(new Error('Photo loading cancelled'), { name: 'AbortError' }); }
function check(signal: AbortSignal) { if (signal.aborted) throw cancelled(); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function responseWithAbort(promise: Promise<Response>, signal: AbortSignal) {
  void promise.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
  return abortable(promise, signal);
}
function validDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > 16384 || height > 16384 || width * height > MAX_PIXELS) throw unavailable();
}

/** Inspect dimensions before decode, so a small compressed file cannot allocate an enormous bitmap. */
function inspect(bytes: Uint8Array, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, size: number) => String.fromCharCode(...bytes.subarray(start, start + size));
  let width = 0; let height = 0;
  if (type === 'image/png' && bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && text(12, 4) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (type === 'image/gif' && bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(text(0, 6))) {
    width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 7) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += size;
    }
  } else if (type === 'image/webp' && bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const chunk = text(12, 4);
    if (chunk === 'VP8X') {
      width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
      height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
    } else if (chunk === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    }
  }
  validDimensions(width, height);
}

/** Re-encode inert pixels; source URLs/metadata never enter the export document. */
export async function normalizeMenuPhoto(file: Blob, signal: AbortSignal): Promise<string> {
  check(signal);
  const type = file.type.toLowerCase().split(';')[0].trim();
  if (!TYPES.has(type) || file.size < 1 || file.size > MAX_BYTES) throw unavailable();
  const bytes = new Uint8Array(await abortable(file.arrayBuffer(), signal));
  check(signal);
  if (!bytes.length || bytes.length > MAX_BYTES) throw unavailable();
  inspect(bytes, type);
  const decoding = createImageBitmap(new Blob([bytes.buffer], { type }));
  let bitmap: ImageBitmap | undefined; let closed = false;
  const close = (value: ImageBitmap) => { if (!closed) { closed = true; value.close(); } };
  // Image decoders do not accept AbortSignal. Release even a result that arrives after cancellation.
  void decoding.then(value => { if (signal.aborted) close(value); }, () => {});
  try {
    bitmap = await abortable(decoding, signal); check(signal);
    validDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw unavailable();
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/png');
    if (!result.startsWith('data:image/png;base64,') || result.length > 2 * 1024 * 1024) throw unavailable();
    return result;
  } finally { if (bitmap) close(bitmap); }
}

async function responsePhoto(response: Response, signal: AbortSignal) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (!response.ok || !TYPES.has(type) || Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) {
    void response.body?.cancel().catch(() => {}); throw unavailable();
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      check(signal);
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength; if (size > MAX_BYTES) throw unavailable(); chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return normalizeMenuPhoto(new Blob([bytes.buffer], { type }), signal);
}

function externalPhotoUrl(source: string) {
  const url = new URL(source);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || !host.includes('.') || /[:\[\]]/.test(host) || /^[\d.]+$/.test(host)
      || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
      || (typeof location !== 'undefined' && url.origin === location.origin)) throw unavailable();
  return url.href;
}

export async function loadMenuRecipePhoto(recipeId: string, sourceUrl: string, signal: AbortSignal): Promise<string> {
  check(signal);
  let response: Response;
  try { response = await responseWithAbort(webApiClient.menus.recipeImage(recipeId, { signal }), signal); }
  catch (error) {
    check(signal);
    if ((error as { status?: number }).status !== 404) throw error;
    // Only the exact selected thumbnail can be tried, directly via browser CORS.
    response = await responseWithAbort(fetch(externalPhotoUrl(sourceUrl), {
      signal, credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
    }), signal);
  }
  return responsePhoto(response, signal);
}
