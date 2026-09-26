import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenuDraft, layoutMenu } from '@cooking/shared';
import { printMenu } from './menuExport';
const draft=createMenuDraft([{id:'one',title:'Dinner'}],['one'],{title:'My menu',section:'Dishes'});
const layout=layoutMenu(draft,text=>text.length*8);
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function printWindow() {
 const popup={closed:false,opener:window,document:{open:vi.fn(),write:vi.fn(),close:vi.fn(),title:'',fonts:{load:vi.fn().mockResolvedValue([]),ready:Promise.resolve()}},requestAnimationFrame:vi.fn(),focus:vi.fn(),print:vi.fn(),close:vi.fn()};
 vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window);return popup;
}
describe('print readiness lifecycle',()=>{
 it('settles when a popup closes before its readiness frame and cannot print later',async()=>{
  vi.useFakeTimers();const popup=printWindow();const promise=printMenu(layout,draft,{fonts:[],artworkDataUrl:null});
  const settled=expect(promise).rejects.toThrow('Print window closed');await vi.advanceTimersByTimeAsync(1);
  popup.closed=true;await vi.advanceTimersByTimeAsync(250);await settled;
  expect(popup.print).not.toHaveBeenCalled();
 });
 it('times out a background popup that never supplies a frame',async()=>{
  vi.useFakeTimers();const popup=printWindow();const promise=printMenu(layout,draft,{fonts:[],artworkDataUrl:null});
  const settled=expect(promise).rejects.toThrow('Print preparation timed out');await vi.advanceTimersByTimeAsync(30_001);await settled;
  expect(popup.print).not.toHaveBeenCalled();expect(popup.close).toHaveBeenCalledOnce();
 });
});
