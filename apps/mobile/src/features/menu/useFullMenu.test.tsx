import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFullMenu } from './useFullMenu';
const mockAccess = jest.fn(); const mockArtworkAccess = jest.fn(); const mockGenerate = jest.fn(); const mockStatus = jest.fn(); const mockFile = jest.fn(); const mockConvert = jest.fn();
const mockApi = { menus: { access: mockAccess, artworkAccess: mockArtworkAccess, generateArtwork: mockGenerate, artworkStatus: mockStatus, artworkFile: mockFile } };
jest.mock('../../lib/api', () => ({ useApiClient: () => mockApi }));
jest.mock('./menuAssets', () => ({ artworkResponseDataUrl: (...args: unknown[]) => mockConvert(...args) }));
const input = { title: 'Dinner', brief: 'Cute tomatoes', recipes: [{ recipe_id: 'one', name: 'Noodles' }] };
const access = { allowed: true, is_admin: false, daily_limit: 1, remaining: 1, resets_at: '2026-09-28T00:00:00Z' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  jest.clearAllMocks();
  mockAccess.mockReset().mockResolvedValue(access);
  mockArtworkAccess.mockReset().mockResolvedValue({ enabled: true, allowed: true, remaining: 2, daily_limit: 3, reason: null });
  mockGenerate.mockReset().mockImplementation(async payload => ({ request_id: payload.request_id, status: 'completed', file_url: '/artwork' }));
  mockStatus.mockReset(); mockFile.mockReset().mockResolvedValue({});
  mockConvert.mockReset().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('full-image generation and body retrieval share one bounded 270-second lifecycle', async () => {
  jest.useFakeTimers(); mockFile.mockReturnValue(new Promise(() => {}));
  const { result, unmount } = await renderHook(() => useFullMenu());
  await act(async () => result.current.generate(input));
  await act(async () => jest.advanceTimersByTime(269_999));
  expect(result.current.busy).toBe(true);
  await act(async () => jest.advanceTimersByTime(1));
  expect(result.current.busy).toBe(false); expect(result.current.recoverable).toBe(true);
  expect(mockFile.mock.calls[0][1].signal.aborted).toBe(true);
  expect(mockGenerate).toHaveBeenCalledTimes(1); expect(mockStatus).not.toHaveBeenCalled();
  await unmount();
});

test('hanging availability lookup becomes a visible retry state after 30 seconds', async () => {
  jest.useFakeTimers(); mockAccess.mockReturnValue(new Promise(() => {}));
  const { result, unmount } = await renderHook(() => useFullMenu());
  await act(async () => jest.advanceTimersByTime(30_000));
  expect(result.current.checkingAccess).toBe(false); expect(result.current.accessError).toBe(true);
  expect(result.current.allowed).toBe(false); expect(mockGenerate).not.toHaveBeenCalled();
  expect(mockAccess.mock.calls[0][0].signal.aborted).toBe(true);
  await unmount();
});

test('cancel during body conversion rejects late private bytes and recovers without another generation', async () => {
  const pending = deferred<string>(); mockConvert.mockReturnValueOnce(pending.promise);
  const { result } = await renderHook(() => useFullMenu());
  await waitFor(() => expect(result.current.allowed).toBe(true));
  await act(async () => result.current.generate(input));
  const payload = mockGenerate.mock.calls[0][0];
  await act(async () => result.current.cancel());
  await act(async () => pending.resolve('data:image/png;base64,late'));
  expect(result.current.result).toBeNull();
  mockStatus.mockResolvedValue({ request_id: payload.request_id, status: 'completed', file_url: '/artwork' });
  await act(async () => result.current.check());
  await waitFor(() => expect(result.current.result).toBe('data:image/png;base64,iVBORw0KGgo='));
  expect(mockGenerate).toHaveBeenCalledTimes(1);
});

test('ambiguous failure cannot auto-resubmit and explicit recovery resubmits only its unchanged snapshot after 404', async () => {
  mockGenerate.mockRejectedValueOnce(new TypeError('offline'));
  mockStatus.mockRejectedValue({ status: 404 });
  const { result } = await renderHook(() => useFullMenu());
  await waitFor(() => expect(result.current.allowed).toBe(true));
  const mutable = { ...input, recipes: [{ ...input.recipes[0] }] };
  await act(async () => result.current.generate(mutable));
  mutable.title = 'Changed'; mutable.recipes[0].name = 'Changed dish';
  await waitFor(() => expect(result.current.recoverable).toBe(true));
  const original = mockGenerate.mock.calls[0][0];
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  await act(async () => result.current.generate(mutable));
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  await act(async () => result.current.check());
  await waitFor(() => expect(result.current.result).not.toBeNull());
  expect(mockGenerate.mock.calls[1][0]).toEqual(original);
  expect(mockGenerate.mock.calls[1][0].recipes).toEqual([{ recipe_id: 'one', name: 'Noodles' }]);
});

test('terminal provider failure unlocks the form while preserving consumed daily admission', async () => {
  mockGenerate.mockImplementation(async payload => ({ request_id: payload.request_id, status: 'failed', error_code: 'provider_failed', file_url: null }));
  const { result } = await renderHook(() => useFullMenu());
  await waitFor(() => expect(result.current.allowed).toBe(true));
  await act(async () => result.current.generate(input));
  await waitFor(() => expect(result.current.error).toBe('menu.simple.terminalFailed'));
  expect(result.current.recoverable).toBe(false); expect(result.current.allowed).toBe(false);
  expect(mockFile).not.toHaveBeenCalled(); expect(mockGenerate).toHaveBeenCalledTimes(1);
});

test('admins can explicitly create another menu with a new ID', async () => {
  mockAccess.mockResolvedValue({ ...access, is_admin: true, daily_limit: null, remaining: null });
  const { result } = await renderHook(() => useFullMenu());
  await waitFor(() => expect(result.current.allowed).toBe(true));
  await act(async () => result.current.generate(input));
  await waitFor(() => expect(result.current.allowed).toBe(true));
  mockGenerate.mockReturnValueOnce(new Promise(() => {}));
  await act(async () => result.current.generate({ ...input, title: 'Another' }));
  expect(result.current.result).toBeNull();
  expect(mockGenerate).toHaveBeenCalledTimes(2);
  expect(mockGenerate.mock.calls[0][0].request_id).not.toBe(mockGenerate.mock.calls[1][0].request_id);
  await act(async () => result.current.cancel());
});

test('new UTC allowance can be refreshed after a consumed session', async () => {
  const { result } = await renderHook(() => useFullMenu());
  await waitFor(() => expect(result.current.allowed).toBe(true));
  await act(async () => result.current.generate(input));
  await waitFor(() => expect(result.current.allowed).toBe(false));
  mockAccess.mockResolvedValue({ ...access, resets_at: '2026-09-29T00:00:00Z' });
  await act(async () => result.current.refresh());
  expect(result.current.allowed).toBe(true);
});

test('an open exhausted menu refreshes availability at the next UTC reset without generating', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-27T23:59:50Z'));
  mockAccess.mockResolvedValueOnce({ ...access, allowed: false, remaining: 0 }).mockResolvedValue({ ...access, resets_at: '2026-09-29T00:00:00Z' });
  const { result, unmount } = await renderHook(() => useFullMenu());
  expect(result.current.allowed).toBe(false);
  await act(async () => jest.advanceTimersByTime(11_000));
  expect(result.current.allowed).toBe(true); expect(mockAccess).toHaveBeenCalledTimes(2);
  expect(mockGenerate).not.toHaveBeenCalled();
  await unmount();
});

test('foregrounding refreshes read-only availability and removes its listener when the session closes', async () => {
  let foreground!: (state: AppStateStatus) => void; const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { foreground = listener; return { remove }; });
  const { result, unmount } = await renderHook(() => useFullMenu());
  await waitFor(() => expect(result.current.allowed).toBe(true));
  mockAccess.mockResolvedValue({ ...access, allowed: false, remaining: 0 });
  expect(foreground).toEqual(expect.any(Function));
  await act(async () => foreground('active'));
  expect(result.current.allowed).toBe(false); expect(mockGenerate).not.toHaveBeenCalled();
  await unmount(); expect(remove).toHaveBeenCalledTimes(1);
});

test('recovering yesterday’s request after an automatic reset does not spend today’s local allowance', async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-27T23:59:50Z'));
  mockGenerate.mockReturnValue(new Promise(() => {}));
  const { result, unmount } = await renderHook(() => useFullMenu());
  await act(async () => result.current.generate(input));
  const original = mockGenerate.mock.calls[0][0];
  await act(async () => result.current.cancel());
  mockAccess.mockResolvedValue({ ...access, resets_at: '2026-09-29T00:00:00Z' });
  await act(async () => jest.advanceTimersByTime(11_000));
  mockStatus.mockResolvedValue({ request_id: original.request_id, status: 'completed', file_url: '/artwork' });
  await act(async () => result.current.check());
  expect(result.current.result).not.toBeNull(); expect(result.current.allowed).toBe(true);
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  await unmount();
});
