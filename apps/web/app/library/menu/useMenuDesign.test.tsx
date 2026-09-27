import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { menuDesignForStyle } from '@cooking/shared';
import { useMenuDesign } from './useMenuDesign';
const mocks = vi.hoisted(() => ({ generate:vi.fn(), account:'first' }));
vi.mock('../../lib/auth', () => ({ useAuth:() => ({ user:{id:mocks.account} }) }));
vi.mock('../../lib/api', () => ({ webApiClient:{menus:{generateDesign:mocks.generate}} }));
const payload={menu_creation_id:'admitted-id',brief:'A sunny bakery',content:{item_count:6,section_count:1,photo_count:6,language:'en' as const}};
beforeEach(() => {mocks.account='first';mocks.generate.mockReset();});
afterEach(() => {cleanup();vi.useRealTimers();});
it('returns a validated proposal without retrying or modifying its request',async()=>{
 mocks.generate.mockResolvedValue(menuDesignForStyle('cozy-cafe'));
 const {result}=renderHook(()=>useMenuDesign());
 await act(async()=>result.current.generate(payload));
 expect(result.current.candidate?.layout).toBe('photo-grid');expect(mocks.generate).toHaveBeenCalledTimes(1);
 expect(mocks.generate.mock.calls[0][0]).toEqual(payload);
 act(()=>result.current.discard());expect(result.current.candidate).toBeNull();
});
it('blocks duplicate clicks and discards late completion after cancellation',async()=>{
 let finish!:(value:unknown)=>void;mocks.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {result}=renderHook(()=>useMenuDesign());
 act(()=>{void result.current.generate(payload);void result.current.generate(payload);});
 await waitFor(()=>expect(mocks.generate).toHaveBeenCalledTimes(1));
 act(()=>result.current.cancel());await act(async()=>finish(menuDesignForStyle('garden-table')));
 expect(result.current.candidate).toBeNull();expect(result.current.busy).toBe(false);expect(result.current.errorKey).toBe('menu.studio.designCancelled');
});
it('clears private suggestions and ignores old-account results',async()=>{
 let finish!:(value:unknown)=>void;mocks.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {result,rerender}=renderHook(()=>useMenuDesign());
 act(()=>{void result.current.generate(payload);});await waitFor(()=>expect(mocks.generate).toHaveBeenCalledTimes(1));
 mocks.account='second';rerender();await act(async()=>finish(menuDesignForStyle('garden-table')));
 expect(result.current.candidate).toBeNull();expect(result.current.busy).toBe(false);expect(result.current.errorKey).toBeNull();
});
it('retains a prior proposal on provider failure and never automatically replays a paid attempt',async()=>{
 mocks.generate.mockResolvedValueOnce(menuDesignForStyle('cozy-cafe')).mockRejectedValueOnce(new TypeError('Network interrupted'));
 const {result}=renderHook(()=>useMenuDesign());
 await act(async()=>result.current.generate(payload));const previous=result.current.candidate;
 await act(async()=>result.current.generate({...payload,brief:'A different design'}));
 expect(result.current.candidate).toBe(previous);expect(result.current.errorKey).toBe('menu.studio.designFailed');expect(mocks.generate).toHaveBeenCalledTimes(2);
});
it('rejects malformed model designs before they reach the renderer',async()=>{
 mocks.generate.mockResolvedValue({...menuDesignForStyle('cozy-cafe'),layout:['photo-grid']});
 const {result}=renderHook(()=>useMenuDesign());await act(async()=>result.current.generate(payload));
 expect(result.current.candidate).toBeNull();expect(result.current.errorKey).toBe('menu.studio.designFailed');
});
it('releases busy state after a stalled transport exceeds the deadline',async()=>{
 vi.useFakeTimers();mocks.generate.mockImplementation(()=>new Promise(()=>{}));
 const {result}=renderHook(()=>useMenuDesign());
 await act(async()=>{void result.current.generate(payload);await vi.advanceTimersByTimeAsync(90001);});
 expect(result.current.busy).toBe(false);expect(result.current.errorKey).toBe('menu.studio.designFailed');expect(mocks.generate).toHaveBeenCalledTimes(1);
});
