import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMenuCreation } from './useMenuCreation';
const mocks = vi.hoisted(() => ({ access: vi.fn(), create: vi.fn() }));
vi.mock('../../lib/api', () => ({ webApiClient: { menus: mocks } }));
const allowed = { allowed: true, is_admin: false, daily_limit: 1, remaining: 1, resets_at: '2026-09-27T00:00:00Z' };
beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue(allowed);
  mocks.create.mockReset().mockImplementation(async payload => ({ ...payload, created_at: '2026-09-26T00:00:00Z' }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('retrieves access without spending the daily menu allowance', async () => {
  const { result } = renderHook(useMenuCreation);
  await waitFor(() => expect(result.current.canContinue).toBe(true));
  expect(mocks.create).not.toHaveBeenCalled();
});

it('bounds admission at 30 seconds and retries the same ID if a request ignores cancellation', async () => {
  vi.useFakeTimers();
  mocks.create.mockImplementationOnce(() => new Promise(() => {}));
  const { result } = renderHook(useMenuCreation);
  await act(async () => {});
  let first!: Promise<boolean>;
  act(() => { first = result.current.ensure(); });
  expect(result.current.busy).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(await first).toBe(false);
  expect(result.current.busy).toBe(false);
  expect(result.current.errorKey).toBe('menu.creation.failed');
  expect(mocks.create.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { expect(await result.current.ensure()).toBe(true); });
  expect(mocks.create.mock.calls[0][0]).toEqual(mocks.create.mock.calls[1][0]);
});

it('permits replay after an ambiguous response even when access now reports the allowance consumed', async () => {
  mocks.create.mockRejectedValueOnce(new TypeError('Connection lost'));
  const { result } = renderHook(useMenuCreation);
  await waitFor(() => expect(result.current.canContinue).toBe(true));
  await act(async () => { expect(await result.current.ensure()).toBe(false); });
  mocks.access.mockResolvedValue({ ...allowed, allowed: false, remaining: 0 });
  await act(async () => { await result.current.refresh(); });
  expect(result.current.canContinue).toBe(true);
  await act(async () => { expect(await result.current.ensure()).toBe(true); });
  expect(mocks.create.mock.calls[0][0]).toEqual(mocks.create.mock.calls[1][0]);
});

it('shares an in-flight admission and does not create another after admission', async () => {
  let finish!: (value: unknown) => void;
  mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(useMenuCreation);
  await waitFor(() => expect(result.current.canContinue).toBe(true));
  let first!: Promise<boolean>; let second!: Promise<boolean>;
  act(() => { first = result.current.ensure(); second = result.current.ensure(); });
  expect(first).toBe(second);
  await act(async () => { finish({ ...mocks.create.mock.calls[0][0], created_at: 'now' }); await first; });
  expect(await result.current.ensure()).toBe(true);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it('aborts admission on unmount and ignores a late completion', async () => {
  let finish!: (value: unknown) => void;
  mocks.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result, unmount } = renderHook(useMenuCreation);
  await waitFor(() => expect(result.current.canContinue).toBe(true));
  let pending!: Promise<boolean>;
  act(() => { pending = result.current.ensure(); });
  unmount();
  expect(await pending).toBe(false);
  finish({ ...mocks.create.mock.calls[0][0], created_at: 'now' });
  expect(mocks.create.mock.calls[0][1].signal.aborted).toBe(true);
});
