import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadMenuRecipePhoto, normalizeMenuPhoto } from './menuPhotos';

const { recipeImage } = vi.hoisted(() => ({ recipeImage: vi.fn() }));
vi.mock('../../lib/api', () => ({ webApiClient: { menus: { recipeImage } } }));
const signal = () => new AbortController().signal;
function png(width = 1600, height = 800) {
  const bytes = new Uint8Array(32); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function file(bytes = png(), type = 'image/png'): Blob {
  return { size: bytes.length, type, arrayBuffer: async () => bytes.buffer } as Blob;
}
const close = vi.fn(); const draw = vi.fn();
beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1600, height: 800, close }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,c2FmZQ==');
  recipeImage.mockReset(); close.mockClear(); draw.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('normalizes a bounded photo into a 512px PNG and releases the decoded bitmap', async () => {
  expect(await normalizeMenuPhoto(file(), signal())).toBe('data:image/png;base64,c2FmZQ==');
  expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 512, 256);
  expect(close).toHaveBeenCalledOnce();
});

test.each([
  ['image/gif', new Uint8Array([71, 73, 70, 56, 57, 97, 64, 1, 160, 0])],
  ['image/jpeg', new Uint8Array([255, 216, 255, 224, 0, 4, 1, 1, 255, 192, 0, 7, 8, 0, 160, 1, 64])],
  ['image/webp', (() => { const b = new Uint8Array(30); b.set(new TextEncoder().encode('RIFF'), 0); b.set(new TextEncoder().encode('WEBPVP8X'), 8); b[24] = 63; b[25] = 1; b[27] = 159; return b; })()],
  ['image/webp', (() => { const b = new Uint8Array(30); b.set(new TextEncoder().encode('RIFF'), 0); b.set(new TextEncoder().encode('WEBPVP8L'), 8); b[20] = 47; new DataView(b.buffer).setUint32(21, 319 | (159 << 14), true); return b; })()],
  ['image/webp', (() => { const b = new Uint8Array(30); b.set(new TextEncoder().encode('RIFF'), 0); b.set(new TextEncoder().encode('WEBPVP8 '), 8); b.set([157, 1, 42, 64, 1, 160, 0], 23); return b; })()],
])('accepted %s headers still export only normalized PNG bytes', async (type, bytes) => {
  await expect(normalizeMenuPhoto(file(bytes, type), signal())).resolves.toMatch(/^data:image\/png;base64,/);
  expect(createImageBitmap).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});

test('rejects unexpectedly huge decoded dimensions and releases the bitmap', async () => {
  vi.mocked(createImageBitmap).mockResolvedValue({ width: 65535, height: 65535, close } as unknown as ImageBitmap);
  await expect(normalizeMenuPhoto(file(), signal())).rejects.toThrow();
  expect(draw).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});

test.each([
  ['active content', file(new TextEncoder().encode('<svg onload="bad()"/>'), 'image/svg+xml')],
  ['mislabeled content', file(new TextEncoder().encode('<html/>'))],
  ['huge pixel dimensions', file(png(60000, 60000))],
  ['oversized pixel area', file(png(10000, 10000))],
  ['zero-sized photo', file(png(0, 800))],
  ['over byte limit', { size: 11 * 1024 * 1024, type: 'image/png', arrayBuffer: vi.fn() } as unknown as Blob],
])('rejects %s before decoding', async (_, input) => {
  await expect(normalizeMenuPhoto(input, signal())).rejects.toThrow();
  expect(createImageBitmap).not.toHaveBeenCalled();
});

test('cancelling a decoder that ignores cancellation discards and closes its late bitmap', async () => {
  let finish!: (value: ImageBitmap) => void;
  vi.mocked(createImageBitmap).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController(); const pending = normalizeMenuPhoto(file(), controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
  controller.abort(); await assertion;
  finish({ width: 1600, height: 800, close } as unknown as ImageBitmap);
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(draw).not.toHaveBeenCalled();
});

test('authenticated receipt response is normalized without fetching the original URL', async () => {
  recipeImage.mockResolvedValue(new Response(png(), { headers: { 'Content-Type': 'image/png' } }));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(await loadMenuRecipePhoto('dish', 'https://images.example.org/a.jpg', signal())).toMatch(/^data:image\/png/);
  expect(recipeImage).toHaveBeenCalledWith('dish', { signal: expect.any(AbortSignal) });
  expect(fetcher).not.toHaveBeenCalled();
});

test('untracked external photo fallback never forwards cookies, auth, referrer or redirects', async () => {
  recipeImage.mockRejectedValue(Object.assign(new Error('not owned'), { status: 404 }));
  const fetcher = vi.fn().mockResolvedValue(new Response(png(), { headers: { 'Content-Type': 'image/png' } }));
  vi.stubGlobal('fetch', fetcher);
  await loadMenuRecipePhoto('dish', 'https://images.example.org/a.png', signal());
  expect(fetcher).toHaveBeenCalledWith('https://images.example.org/a.png', {
    signal: expect.any(AbortSignal), credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
  });
});

test.each(['http://images.example.org/a.png', 'https://user:password@images.example.org/a.png', 'https://127.0.0.1/a.png', 'https://localhost/a.png', 'https://host.local/a.png', 'data:image/png;base64,AA==', '/uploads/a.png'])('rejects unsafe fallback URL %s', async url => {
  recipeImage.mockRejectedValue(Object.assign(new Error(), { status: 404 }));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(loadMenuRecipePhoto('dish', url, signal())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

test('auth errors do not trigger an external fallback', async () => {
  recipeImage.mockRejectedValue(Object.assign(new Error('expired'), { status: 401 }));
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(loadMenuRecipePhoto('dish', 'https://images.example.org/a.png', signal())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

test('cancelling an owned fetch also closes a response that arrives too late', async () => {
  let finish!: (value: Response) => void;
  recipeImage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = loadMenuRecipePhoto('dish', 'https://images.example.org/a.png', controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await assertion;
  const cancel = vi.fn();
  finish(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/png' } }));
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(createImageBitmap).not.toHaveBeenCalled();
});

test('stream byte limit cancels a chunked body even without content length', async () => {
  const cancel = vi.fn();
  recipeImage.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11 * 1024 * 1024)); }, cancel }), { headers: { 'Content-Type': 'image/png' } }));
  await expect(loadMenuRecipePhoto('dish', 'https://images.example.org/a.png', signal())).rejects.toThrow();
  expect(cancel).toHaveBeenCalled(); expect(createImageBitmap).not.toHaveBeenCalled();
});
