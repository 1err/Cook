import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MenuItem } from '@cooking/shared';
import { useMenuPhotos } from './useMenuPhotos';

const mocks = vi.hoisted(() => ({ owner: 'alice' as string | null, load: vi.fn(), normalize: vi.fn() }));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: mocks.owner ? { id: mocks.owner } : null, loading: false }) }));
vi.mock('./menuPhotos', () => ({ loadMenuRecipePhoto: mocks.load, normalizeMenuPhoto: mocks.normalize }));
const item = (recipeId = 'dish', imageUrl: string | null = 'https://images.example.org/a.png'): MenuItem => ({ recipeId, imageUrl, sectionId: 'main', name: recipeId, description: '' });
beforeEach(() => { mocks.owner = 'alice'; mocks.load.mockReset(); mocks.normalize.mockReset(); mocks.load.mockResolvedValue('data:image/png;base64,auto'); });
afterEach(cleanup);

test('loads each selected URL snapshot once and skips missing images', async () => {
  const view = renderHook(({ items }) => useMenuPhotos(items), { initialProps: { items: [item(), item('no-photo', null)] } });
  await waitFor(() => expect(view.result.current.images).toEqual({ dish: 'data:image/png;base64,auto' }));
  view.rerender({ items: [{ ...item(), name: 'Edited name' }, item('no-photo', null)] });
  expect(mocks.load).toHaveBeenCalledTimes(1); expect(view.result.current.loading).toBe(false);
});

test('React strict effect replay still loads the active photo', async () => {
  mocks.load.mockImplementation((_id, _url, signal) => new Promise((resolve, reject) => {
    queueMicrotask(() => signal.aborted ? reject(new Error('cancelled')) : resolve('data:image/png;base64,strict'));
  }));
  const view = renderHook(() => useMenuPhotos([item()]), { wrapper: StrictMode });
  await waitFor(() => expect(view.result.current.images.dish).toBe('data:image/png;base64,strict'));
});

test('automatic loads use three concurrent requests and advance the queue as each finishes', async () => {
  const finish: ((value: string) => void)[] = [];
  mocks.load.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  const view = renderHook(() => useMenuPhotos(Array.from({ length: 6 }, (_, i) => item(String(i)))));
  expect(mocks.load).toHaveBeenCalledTimes(3);
  await act(async () => { finish[0]('data:image/png;base64,first'); });
  expect(mocks.load).toHaveBeenCalledTimes(4);
  view.unmount();
});

test('a photo timeout ends loading and makes explicit retry available', async () => {
  vi.useFakeTimers(); mocks.load.mockImplementation(() => new Promise(() => {}));
  const view = renderHook(() => useMenuPhotos([item()]));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.errors.dish).toBe('menu.photos.failed');
  expect(mocks.load.mock.calls[0][2].aborted).toBe(true);
  view.unmount(); vi.useRealTimers();
});

test('manual removal suppresses autoload and retry until the original thumbnail changes', async () => {
  const view = renderHook(({ items }) => useMenuPhotos(items), { initialProps: { items: [item()] } });
  await waitFor(() => expect(view.result.current.images.dish).toBeDefined());
  act(() => view.result.current.remove('dish')); act(() => view.result.current.retry());
  expect(view.result.current.images).toEqual({}); expect(mocks.load).toHaveBeenCalledTimes(1);
  view.rerender({ items: [item('dish', 'https://images.example.org/b.png')] });
  await waitFor(() => expect(view.result.current.images.dish).toBeDefined());
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

test('an uploaded photo wins over late automatic bytes and survives text edits', async () => {
  let finish!: (value: string) => void;
  mocks.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.normalize.mockResolvedValue('data:image/png;base64,upload');
  const view = renderHook(({ items }) => useMenuPhotos(items), { initialProps: { items: [item()] } });
  await act(async () => { await view.result.current.upload('dish', new File(['fake'], 'local.png')); });
  await act(async () => { finish('data:image/png;base64,late'); });
  expect(mocks.load.mock.calls[0][2].aborted).toBe(true);
  expect(view.result.current.images.dish).toBe('data:image/png;base64,upload');
  view.rerender({ items: [{ ...item(), description: 'New editable text' }] });
  expect(view.result.current.images.dish).toBe('data:image/png;base64,upload');
});

test('account changes hide prior photos immediately and reject late results from that account', async () => {
  let finish!: (value: string) => void;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useMenuPhotos([item()]));
  mocks.owner = 'bob'; view.rerender();
  expect(view.result.current.images).toEqual({});
  await act(async () => { finish('data:image/png;base64,alice'); });
  await waitFor(() => expect(view.result.current.images.dish).toBe('data:image/png;base64,auto'));
  mocks.owner = null; view.rerender();
  expect(view.result.current.images).toEqual({}); expect(view.result.current.loading).toBe(false);
});

test('changing or deselecting a recipe aborts its pending photo without accepting late bytes', async () => {
  let finish!: (value: string) => void;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(({ items }) => useMenuPhotos(items), { initialProps: { items: [item()] } });
  view.rerender({ items: [] });
  await act(async () => { finish('data:image/png;base64,old'); });
  expect(view.result.current.images).toEqual({}); expect(mocks.load.mock.calls[0][2].aborted).toBe(true);
});

test('failed photos expose a per-recipe error and only explicit retry starts another load', async () => {
  mocks.load.mockRejectedValueOnce(new Error('CORS unavailable'));
  const view = renderHook(() => useMenuPhotos([item()]));
  await waitFor(() => expect(view.result.current.errors).toEqual({ dish: 'menu.photos.failed' }));
  expect(mocks.load).toHaveBeenCalledTimes(1);
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.images.dish).toBeDefined());
  expect(view.result.current.errors).toEqual({});
});

test('unmount aborts both auto loads and uploads', async () => {
  mocks.load.mockImplementation(() => new Promise(() => {}));
  mocks.normalize.mockImplementation(() => new Promise(() => {}));
  const view = renderHook(() => useMenuPhotos([item(), item('second')]));
  let upload!: Promise<void>;
  act(() => { upload = view.result.current.upload('dish', new File(['fake'], 'local.png')); });
  view.unmount();
  await expect(upload).resolves.toBeUndefined();
  expect(mocks.load.mock.calls.every(call => call[2].aborted)).toBe(true);
  expect(mocks.normalize.mock.calls[0][1].aborted).toBe(true);
});
