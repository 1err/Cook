import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMenuArtwork } from './useMenuArtwork';
const mocks = vi.hoisted(() => ({ access:vi.fn(),generate:vi.fn(),status:vi.fn(),file:vi.fn(),decode:vi.fn(),account:'first' }));
vi.mock('../../lib/auth',()=>({useAuth:()=>({user:{id:mocks.account}})}));
vi.mock('../../lib/api',()=>({webApiClient:{menus:{artworkAccess:mocks.access,generateArtwork:mocks.generate,artworkStatus:mocks.status,artworkFile:mocks.file}}}));
vi.mock('./menuAssets',()=>({artworkResponseDataUrl:mocks.decode}));
beforeEach(()=>{mocks.account='first';mocks.access.mockReset().mockResolvedValue({enabled:true,allowed:true,daily_limit:3,remaining:3});mocks.generate.mockReset();mocks.status.mockReset();mocks.file.mockReset().mockResolvedValue(new Response());mocks.decode.mockReset().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('menu artwork session boundary',()=>{
 it('ignores a late old-account completion and clears private request metadata',async()=>{
  let finish!:(value:unknown)=>void;mocks.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const {result,rerender}=renderHook(()=>useMenuArtwork());await waitFor(()=>expect(result.current.access?.allowed).toBe(true));
  act(()=>result.current.generate('cozy-cafe','private notes'));expect(result.current.busy).toBe(true);
  mocks.account='second';rerender();await act(async()=>finish({status:'completed'}));
  expect(result.current.candidate).toBeNull();expect(result.current.busy).toBe(false);expect(result.current.recoverable).toBe(false);expect(mocks.file).not.toHaveBeenCalled();
  act(()=>result.current.check());expect(mocks.status).not.toHaveBeenCalled();
 });
 it('blocks duplicate submissions and ignores completion after local cancel',async()=>{
  let finish!:(value:unknown)=>void;mocks.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const {result}=renderHook(()=>useMenuArtwork());await waitFor(()=>expect(result.current.access?.allowed).toBe(true));
  act(()=>{result.current.generate('cozy-cafe','one');result.current.generate('garden-table','two');});
  expect(mocks.generate).toHaveBeenCalledTimes(1);act(()=>result.current.cancel());await act(async()=>finish({status:'completed'}));
  expect(result.current.candidate).toBeNull();expect(result.current.recoverable).toBe(true);expect(mocks.file).not.toHaveBeenCalled();
 });
 it('check-again reuses the original id/style/notes after a failed call',async()=>{
  mocks.generate.mockRejectedValueOnce({status:429,code:'daily_limit'}).mockResolvedValueOnce({status:'completed'});mocks.status.mockRejectedValue({status:404});
  const {result}=renderHook(()=>useMenuArtwork());await waitFor(()=>expect(result.current.access?.allowed).toBe(true));
  act(()=>result.current.generate('french-bistro','Original notes'));await waitFor(()=>expect(result.current.recoverable).toBe(true));
  const original=mocks.generate.mock.calls[0][0];act(()=>result.current.check());await waitFor(()=>expect(result.current.candidate).not.toBeNull());
  expect(mocks.status.mock.calls[0][0]).toBe(original.request_id);expect(mocks.generate.mock.calls[1][0]).toEqual(original);
  expect(result.current.candidate?.metadata).toEqual({requestId:original.request_id,styleId:'french-bistro',instructions:'Original notes'});
 });
});


describe('whole artwork operation deadline',()=>{
 it('bounds a stalled authenticated file request and recovers the original request',async()=>{
  let finishFile!:(response:Response)=>void;
  mocks.generate.mockResolvedValue({status:'completed'});
  mocks.file.mockImplementationOnce(()=>new Promise(resolve=>{finishFile=resolve;}));
  const {result}=renderHook(()=>useMenuArtwork());
  await waitFor(()=>expect(result.current.access?.allowed).toBe(true));
  vi.useFakeTimers();
  await act(async()=>{result.current.generate('french-bistro','Original notes');await vi.advanceTimersByTimeAsync(0);});
  expect(mocks.file).toHaveBeenCalledTimes(1);
  const original=mocks.generate.mock.calls[0][0];
  const signal=mocks.file.mock.calls[0][1].signal as AbortSignal;
  await act(async()=>{await vi.advanceTimersByTimeAsync(90_001);});
  expect(result.current.busy).toBe(false);
  expect(signal.aborted).toBe(true);
  expect(result.current.errorKey).toBe('menu.artwork.failed');
  expect(result.current.recoverable).toBe(true);
  expect(result.current.candidate).toBeNull();
  vi.useRealTimers();
  mocks.status.mockResolvedValue({status:'completed'});
  await act(async()=>result.current.check());
  await waitFor(()=>expect(result.current.candidate).not.toBeNull());
  expect(mocks.status.mock.calls[0][0]).toBe(original.request_id);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(result.current.candidate?.metadata).toEqual({requestId:original.request_id,styleId:'french-bistro',instructions:'Original notes'});
  await act(async()=>finishFile(new Response()));
  expect(mocks.decode).toHaveBeenCalledTimes(1);
 });
 it('bounds a stalled PNG body and ignores bytes that arrive after the deadline',async()=>{
  const actual=await vi.importActual<typeof import('./menuAssets')>('./menuAssets');
  let stream!:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(controller){stream=controller;}});
  mocks.generate.mockResolvedValue({status:'completed'});
  mocks.file.mockResolvedValue(new Response(body,{headers:{'Content-Type':'image/png'}}));
  mocks.decode.mockImplementation(actual.artworkResponseDataUrl);
  const {result}=renderHook(()=>useMenuArtwork());
  await waitFor(()=>expect(result.current.access?.allowed).toBe(true));
  vi.useFakeTimers();
  await act(async()=>{result.current.generate('garden-table','Keep the previous design');await vi.advanceTimersByTimeAsync(0);});
  expect(mocks.decode).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(90_001);});
  expect(result.current.busy).toBe(false);
  expect(result.current.recoverable).toBe(true);
  expect(result.current.errorKey).toBe('menu.artwork.failed');
  expect((mocks.file.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  await act(async()=>{stream.enqueue(new Uint8Array([137,80,78,71,13,10,26,10]));stream.close();});
  expect(result.current.candidate).toBeNull();
 });
});
