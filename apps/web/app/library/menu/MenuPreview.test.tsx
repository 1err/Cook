import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMenuDraft, layoutMenu } from '@cooking/shared';
import { isMenuRendererMessage, MenuPreview } from './MenuPreview';
vi.mock('../../lib/i18n',()=>({useT:()=>(key:string)=>key}));
const draft=createMenuDraft([{id:'one',title:'Dinner'}],['one'],{title:'My menu',section:'Dishes'});
const assets={fonts:[],artworkDataUrl:null};const layout=layoutMenu(draft,text=>text.length*8);
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}));afterEach(cleanup);
describe('iframe bridge boundary',()=>{
 it('rejects stale revisions, wrong channels, malformed layout, and invalid png',()=>{
  expect(isMenuRendererMessage({channel:'chefworld-menu',type:'ready',revision:1,layout,pageCount:1},1)).toBe(true);
  expect(isMenuRendererMessage({channel:'other',type:'ready',revision:1,layout,pageCount:1},1)).toBe(false);
  expect(isMenuRendererMessage({channel:'chefworld-menu',type:'ready',revision:0,layout,pageCount:1},1)).toBe(false);
  expect(isMenuRendererMessage({channel:'chefworld-menu',type:'ready',revision:1,layout:{...layout,pages:[{runs:[{}],itemStarts:[]}]},pageCount:1},1)).toBe(false);
  expect(isMenuRendererMessage({channel:'chefworld-menu',type:'png',revision:1,pageIndex:-1,dataUrl:'data:image/png;base64,iVBORw0KGgo='},1)).toBe(false);
 });
 it('retains initial iframe HTML, sends draft-only updates, and ignores messages from other windows',()=>{
  const onReady=vi.fn(),onPng=vi.fn(),onError=vi.fn();
  const props={draft,assets,revision:0,pageIndex:0,onReady,onPng,onError};
  const {container,rerender}=render(<MenuPreview {...props}/>);const iframe=container.querySelector('iframe')!; const initial=iframe.srcdoc;
  const post=vi.spyOn(iframe.contentWindow!,'postMessage');fireEvent.load(iframe);
  rerender(<MenuPreview {...props} draft={{...draft,title:'Edited'}} revision={1}/>);
  expect(iframe.srcdoc).toBe(initial);expect(post).toHaveBeenLastCalledWith({channel:'chefworld-menu',type:'render',revision:1,draft:{...draft,title:'Edited'}},'*');
  const data={channel:'chefworld-menu',revision:1,type:'ready',layout,pageCount:1};
  fireEvent(window,new MessageEvent('message',{source:window,data}));expect(onReady).not.toHaveBeenCalled();
  fireEvent(window,new MessageEvent('message',{source:iframe.contentWindow,data:JSON.stringify(data)}));expect(onReady).toHaveBeenCalledWith(layout,1);
  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
 });
});
