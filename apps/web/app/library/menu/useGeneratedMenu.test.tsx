import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneratedMenu } from './useGeneratedMenu';
const mocks = vi.hoisted(() => ({ access:vi.fn(), artworkAccess:vi.fn(), generate:vi.fn(), status:vi.fn(), file:vi.fn(), decode:vi.fn(), account:'first' }));
vi.mock('../../lib/auth', () => ({ useAuth:() => ({ user:{ id:mocks.account } }) }));
vi.mock('../../lib/api', () => ({ webApiClient:{ menus:{ access:mocks.access, artworkAccess:mocks.artworkAccess, generateArtwork:mocks.generate, artworkStatus:mocks.status, artworkFile:mocks.file } } }));
vi.mock('./menuAssets', () => ({ artworkResponseDataUrl:mocks.decode }));
const input = () => ({ title:'Our kitchen', brief:'Cute tomatoes', recipes:[{ recipe_id:'one', name:'Tomato eggs' }] });
beforeEach(() => {
 mocks.account='first';
 mocks.access.mockReset().mockResolvedValue({ allowed:true, is_admin:false, daily_limit:1, remaining:1, resets_at:'2026-09-28T00:00:00Z' });
 mocks.artworkAccess.mockReset().mockResolvedValue({ enabled:true, allowed:true });
 mocks.generate.mockReset(); mocks.status.mockReset(); mocks.file.mockReset().mockResolvedValue(new Response()); mocks.decode.mockReset().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('full menu generation', () => {
 it('blocks duplicate paid submissions and accepts the completed PNG directly', async () => {
  let finish!:(value:unknown) => void; mocks.generate.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  const { result } = renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  act(() => { result.current.generate(input()); result.current.generate(input()); });
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  await act(async () => finish({ status:'completed' }));
  expect(result.current.result?.dataUrl).toContain('data:image/png'); expect(result.current.canGenerate).toBe(false);
  expect(mocks.file.mock.calls[0][0]).toBe(mocks.generate.mock.calls[0][0].request_id);
 });
 it('ignores late completion and clears private metadata after an account switch', async () => {
  let finish!:(value:unknown) => void; mocks.generate.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  const { result, rerender } = renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  act(() => result.current.generate(input())); mocks.account='second'; rerender();
  await act(async () => finish({ status:'completed' }));
  expect(result.current.result).toBeNull(); expect(result.current.recoverable).toBe(false); expect(mocks.file).not.toHaveBeenCalled();
  act(() => result.current.check()); expect(mocks.status).not.toHaveBeenCalled();
 });
 it('recovers the exact original ordered names and prompt after cancel without issuing another paid request', async () => {
  let finish!:(value:unknown) => void; mocks.generate.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  const { result } = renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  const original=input(); act(() => result.current.generate(original));
  original.recipes[0].name='Changed name'; original.brief='Changed prompt';
  const request=mocks.generate.mock.calls[0][0]; act(() => result.current.cancel());
  await act(async () => finish({ status:'completed' }));
  expect(result.current.result).toBeNull(); expect(result.current.recoverable).toBe(true); expect(result.current.canGenerate).toBe(false);
  mocks.status.mockResolvedValue({ status:'completed' }); act(() => result.current.check());
  await waitFor(() => expect(result.current.result).not.toBeNull());
  expect(mocks.generate).toHaveBeenCalledTimes(1); expect(mocks.status.mock.calls[0][0]).toBe(request.request_id);
  expect(result.current.result?.title).toBe('Our kitchen'); expect(request.recipes[0].name).toBe('Tomato eggs'); expect(request.brief).toBe('Cute tomatoes');
 });
 it('bounds a stalled PNG body and can recover using the original request', async () => {
  let finish!:(value:string) => void; mocks.generate.mockResolvedValue({ status:'completed' }); mocks.decode.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
  const { result } = renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  vi.useFakeTimers(); await act(async () => { result.current.generate(input()); await vi.advanceTimersByTimeAsync(0); });
  const request=mocks.generate.mock.calls[0][0];
  await act(async () => { await vi.advanceTimersByTimeAsync(270_001); });
  expect(result.current.busy).toBe(false); expect(result.current.recoverable).toBe(true);
  expect((mocks.file.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  await act(async () => finish('data:image/png;base64,LATE')); expect(result.current.result).toBeNull();
  vi.useRealTimers(); mocks.status.mockResolvedValue({ status:'completed' }); act(() => result.current.check());
  await waitFor(() => expect(result.current.result).not.toBeNull());
  expect(mocks.status.mock.calls[0][0]).toBe(request.request_id); expect(mocks.generate).toHaveBeenCalledTimes(1);
 });
 it('does not accept a result or request another file after unmount', async () => {
  let finish!:(value:unknown) => void; mocks.generate.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  const { result, unmount } = renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  act(() => result.current.generate(input())); const signal=mocks.generate.mock.calls[0][1].signal as AbortSignal;
  unmount(); await act(async () => finish({ status:'completed' }));
  expect(signal.aborted).toBe(true); expect(mocks.file).not.toHaveBeenCalled();
 });
 it('keeps the daily admission spent after a terminal provider failure even if access refresh is stale', async () => {
  mocks.generate.mockResolvedValue({ status:'failed' });
  const { result } = renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  act(() => result.current.generate(input()));
  await waitFor(() => expect(result.current.errorKey).toBe('menu.simple.terminalFailed'));
  expect(result.current.canGenerate).toBe(false); expect(result.current.recoverable).toBe(false);
  act(() => result.current.generate(input())); expect(mocks.generate).toHaveBeenCalledTimes(1);
 });
 it('unlocks an invalid recipe selection but keeps an unknown status 404 recoverable', async () => {
  mocks.generate.mockRejectedValueOnce({ status:404,code:'recipe_not_found' });
  const { result } = renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  act(() => result.current.generate(input()));
  await waitFor(() => expect(result.current.errorKey).toBe('menu.simple.selectionChanged'));
  expect(result.current.recoverable).toBe(false);
  await waitFor(() => expect(result.current.canGenerate).toBe(true));
  mocks.generate.mockRejectedValueOnce(new TypeError('Connection lost')); mocks.status.mockRejectedValueOnce({ status:404 });
  act(() => result.current.generate(input()));
  await waitFor(() => expect(result.current.recoverable).toBe(true)); expect(result.current.canGenerate).toBe(false);
 });
 it('refreshes the spent daily allowance at the server reset without closing the form', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T23:59:58Z')); mocks.generate.mockResolvedValue({ status:'completed' });
  const { result }=renderHook(() => useGeneratedMenu()); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { result.current.generate(input()); await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.canGenerate).toBe(false);
  mocks.access.mockResolvedValue({ allowed:true,is_admin:false,daily_limit:1,remaining:1,resets_at:'2026-09-29T00:00:00Z' });
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(result.current.canGenerate).toBe(true);
 });
 it('does not spend today locally when an earlier-day cancelled request is recovered after focusing the tab', async () => {
  let finish!:(value:unknown) => void; mocks.generate.mockImplementation(() => new Promise(resolve => { finish=resolve; }));
  const { result }=renderHook(() => useGeneratedMenu()); await waitFor(() => expect(result.current.canGenerate).toBe(true));
  act(() => result.current.generate(input())); act(() => result.current.cancel());
  await act(async () => finish({ status:'completed' }));
  mocks.access.mockResolvedValue({ allowed:true,is_admin:false,daily_limit:1,remaining:1,resets_at:'2026-09-29T00:00:00Z' });
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(result.current.access?.resets_at).toBe('2026-09-29T00:00:00Z'));
  mocks.status.mockResolvedValue({ status:'completed' }); act(() => result.current.check());
  await waitFor(() => expect(result.current.result).not.toBeNull());
  await waitFor(() => expect(result.current.canGenerate).toBe(true));
 });
 it('bounds unavailable access checks and allows an explicit retry', async () => {
  mocks.access.mockImplementationOnce(() => new Promise(() => {})); vi.useFakeTimers();
  const { result } = renderHook(() => useGeneratedMenu());
  await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
  expect(result.current.checkingAccess).toBe(false); expect(result.current.canGenerate).toBe(false); expect(result.current.accessError).toBe('menu.creation.unavailable');
  vi.useRealTimers(); act(() => { void result.current.refresh(); }); await waitFor(() => expect(result.current.canGenerate).toBe(true));
 });
});
