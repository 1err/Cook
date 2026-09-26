import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useMenuArtwork } from './useMenuArtwork';
const mockAccess = jest.fn(); const mockGenerate = jest.fn(); const mockStatus = jest.fn(); const mockFile = jest.fn();
const mockApi = { menus: { artworkAccess: mockAccess, generateArtwork: mockGenerate, artworkStatus: mockStatus, artworkFile: mockFile } };
jest.mock('../../lib/api', () => ({ useApiClient: () => mockApi }));
jest.mock('./menuAssets', () => ({ artworkResponseDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=' }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  jest.clearAllMocks();
  mockAccess.mockResolvedValue({ allowed: true, remaining: 2, daily_limit: 3 });
  mockFile.mockResolvedValue({});
});
test('cancels locally, ignores late completion and recovers the same request ID explicitly', async () => {
  const pending = deferred<any>(); mockGenerate.mockReturnValue(pending.promise);
  const { result } = await renderHook(() => useMenuArtwork());
  await waitFor(() => expect(result.current.access?.allowed).toBe(true));
  await act(async () => result.current.generate('cozy-cafe', 'Soft colors'));
  const payload = mockGenerate.mock.calls[0][0];
  await act(async () => result.current.cancel());
  await act(async () => pending.resolve({ request_id: payload.request_id, status: 'completed' }));
  expect(result.current.candidate).toBeNull(); expect(result.current.recoverable).toBe(true);
  mockStatus.mockResolvedValue({ request_id: payload.request_id, status: 'completed' });
  await act(async () => result.current.check());
  await waitFor(() => expect(result.current.candidate?.metadata).toEqual({ requestId: payload.request_id, styleId: 'cozy-cafe', instructions: 'Soft colors' }));
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(mockStatus).toHaveBeenCalledWith(payload.request_id, { signal: expect.any(AbortSignal) });
  expect(mockFile).toHaveBeenCalledWith(payload.request_id, { signal: expect.any(AbortSignal) });
});
test('aborts pending work on session unmount and never downloads the late artwork', async () => {
  const pending = deferred<any>(); mockGenerate.mockReturnValue(pending.promise);
  const { result, unmount } = await renderHook(() => useMenuArtwork());
  await waitFor(() => expect(result.current.access?.allowed).toBe(true));
  await act(async () => result.current.generate('chinese-teahouse', ''));
  const [payload, options] = mockGenerate.mock.calls[0];
  await unmount();
  expect(options.signal.aborted).toBe(true);
  await act(async () => pending.resolve({ request_id: payload.request_id, status: 'completed' }));
  expect(mockFile).not.toHaveBeenCalled();
});
test('applies a portable 90-second deadline to stalled byte retrieval', async () => {
  jest.useFakeTimers();
  mockGenerate.mockImplementation(async payload => ({ request_id: payload.request_id, status: 'completed' }));
  mockFile.mockReturnValue(new Promise(() => {}));
  const { result, unmount } = await renderHook(() => useMenuArtwork());
  await act(async () => result.current.generate('cozy-cafe', ''));
  await act(async () => jest.advanceTimersByTime(90_000));
  expect(result.current.busy).toBe(false);
  expect(result.current.recoverable).toBe(true);
  expect(result.current.errorKey).toBe('menu.artwork.failed');
  expect(mockFile.mock.calls[0][1].signal.aborted).toBe(true);
  await unmount(); jest.useRealTimers();
});
