import { afterEach, expect, test, vi } from 'vitest';
import { menuDesignForStyle } from '@cooking/shared';
import { createApiClient, resolveMenuDesign, type GenerateMenuDesignPayload } from './index';

const payload = (): GenerateMenuDesignPayload => ({
  menu_creation_id: 'admitted-menu', brief: 'An illustrated noodle bar',
  preferences: { density: 'comfortable' },
  content: { item_count: 12, section_count: 3, photo_count: 8, language: 'en' },
});
const design = menuDesignForStyle('cozy-cafe');
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('design HTTP request preserves cookie auth, payload and cancellation', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(design)));
  vi.stubGlobal('fetch', fetcher);
  const client = createApiClient({ baseUrl: 'https://api.example/', auth: { kind: 'cookie' } });
  const signal = new AbortController().signal;
  const input = payload();
  await expect(client.menus.generateDesign(input, { signal })).resolves.toEqual(design);
  expect(fetcher).toHaveBeenCalledWith('https://api.example/menus/designs', expect.objectContaining({
    method: 'POST', credentials: 'include', body: JSON.stringify(input), signal,
  }));
});

test('owned recipe image uses encoded ID and native bearer auth with unchanged binary response', async () => {
  const response = new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  const client = createApiClient({ baseUrl: 'https://api.example', auth: { kind: 'bearer', getToken: () => 'native-test-token' } });
  const signal = new AbortController().signal;
  expect(await client.menus.recipeImage('recipe / id', { signal })).toBe(response);
  expect(fetcher.mock.calls[0][0]).toBe('https://api.example/menus/recipe-images/recipe%20%2F%20id');
  expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({ signal, credentials: 'omit' }));
  expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer native-test-token');
});

test('lost design response never triggers an automatic paid retry', async () => {
  const generateDesign = vi.fn().mockRejectedValue(new TypeError('connection lost'));
  await expect(resolveMenuDesign({ generateDesign }, payload(), { signal: new AbortController().signal })).rejects.toThrow('connection lost');
  expect(generateDesign).toHaveBeenCalledOnce();
});

test('design captures the original nested preferences before the first await', async () => {
  const generateDesign = vi.fn().mockResolvedValue(design);
  const input = payload();
  const request = resolveMenuDesign({ generateDesign }, input, { signal: new AbortController().signal });
  input.brief = 'Changed'; input.preferences!.density = 'compact'; input.content.item_count = 99;
  await request;
  expect(generateDesign.mock.calls[0][0]).toEqual(payload());
});

test('design deadline bounds a transport that ignores cancellation', async () => {
  vi.useFakeTimers();
  const generateDesign = vi.fn().mockImplementation(() => new Promise(() => {}));
  const request = resolveMenuDesign({ generateDesign }, payload(), { signal: new AbortController().signal });
  const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError', message: 'Menu design request timed out' });
  await vi.advanceTimersByTimeAsync(90_000);
  await assertion;
  expect(generateDesign.mock.calls[0][1].signal.aborted).toBe(true);
  expect(generateDesign).toHaveBeenCalledOnce();
});

test('caller cancellation is platform neutral and ignores late results', async () => {
  vi.stubGlobal('DOMException', undefined);
  let finish!: (value: typeof design) => void;
  const generateDesign = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const request = resolveMenuDesign({ generateDesign }, payload(), { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  finish(design);
  expect(generateDesign).toHaveBeenCalledOnce();
});

test('already cancelled design request never reaches the provider route', async () => {
  const generateDesign = vi.fn(); const controller = new AbortController(); controller.abort();
  await expect(resolveMenuDesign({ generateDesign }, payload(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(generateDesign).not.toHaveBeenCalled();
});
