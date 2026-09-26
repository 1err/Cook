import { test, expect, chromium, webkit } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMenuPreviewHtml, buildMenuPrintHtml } from '../../../packages/shared/src/menu/html';
import type { MenuDraft } from '../../../packages/shared/src/menu/types';
import type { MenuFontAsset, MenuRendererMessage } from '../../../packages/shared/src/menu/runtime';

const fontRoot=new URL('../../../packages/shared/assets/menu-fonts/',import.meta.url).pathname;
const fonts:MenuFontAsset[]=[['MenuCJK',400,'NotoSansCJKsc-Regular.otf'],['MenuSans',400,'Inter-400.ttf'],['MenuSans',600,'Inter-600.ttf'],['MenuSerif',400,'SourceSerif4-400.ttf'],['MenuSerif',600,'SourceSerif4-600.ttf']].map(([family,weight,file])=>({family:String(family),weight:Number(weight),dataUrl:`data:font/${String(file).endsWith('.otf')?'otf':'ttf'};base64,${readFileSync(resolve(fontRoot,String(file))).toString('base64')}`}));
const draft:MenuDraft={title:'家宴 · Dinner',subtitle:'A table for everyone',instructions:'',styleId:'chinese-teahouse',artwork:null,sections:[{id:'mains',title:'主菜 / Main courses'}],items:Array.from({length:8},(_,index)=>({recipeId:String(index),sectionId:'mains',name:`${index+1}. 菜肴 👩🏽‍🍳 酸菜鱼与红烧狮子头`,description:'鲜香四溢，慢火炖煮。 A warm meal together 👨‍👩‍👧‍👦 '.repeat(index===0?120:10)}))};

for(const engine of ['chromium','webkit'] as const){
 test(`${engine}: shared measured CJK preview, PNG, print, and revision bridge`,async({},testInfo)=>{
  test.setTimeout(120_000);
  const browser=await (engine==='chromium'?chromium:webkit).launch();
  const page=await browser.newPage({viewport:{width:900,height:1200}});
  const failures:string[]=[];page.on('pageerror',error=>failures.push(error.message));
  try {
   await page.addInitScript(()=>{
    (window as any).menuMessages=[];
    window.addEventListener('menu-renderer-message',event=>(window as any).menuMessages.push((event as CustomEvent).detail));
   });
   const html=buildMenuPreviewHtml(draft,{fonts,artworkDataUrl:null,revision:1});
   await page.route('http://menu.test/',route=>route.fulfill({body:html,contentType:'text/html'}));
   await page.goto('http://menu.test/');
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.map((m:any)=>m.type))).toContain('ready');
   expect(failures).toEqual([]);
   const ready=await page.evaluate(()=>(window as any).menuMessages.find((m:any)=>m.type==='ready')) as Extract<MenuRendererMessage,{type:'ready'}>;
   expect(ready.pageCount).toBeGreaterThan(2);
   expect(ready.layout.pages.flatMap(p=>p.itemStarts)).toEqual(draft.items.map(i=>i.recipeId));
   expect(ready.layout.pages.flatMap(p=>p.runs).filter(r=>r.itemId==='0').map(r=>r.text).join('')).toBe(draft.items[0].name+draft.items[0].description);
   const bounds=await page.locator('.menu-page text').evaluateAll(nodes=>nodes.map(node=>{const box=(node as SVGTextElement).getBBox();return{x:box.x,y:box.y,right:box.x+box.width,bottom:box.y+box.height};}));
   for(const box of bounds){expect(box.x).toBeGreaterThanOrEqual(70);expect(box.right).toBeLessThanOrEqual(746);expect(box.bottom).toBeLessThanOrEqual(1010);}
   expect(await page.evaluate(()=>document.fonts.check('400 16px MenuCJK','龘鬱麵'))).toBe(true);
   await page.screenshot({path:testInfo.outputPath(`${engine}-menu.png`),fullPage:false});
   await page.evaluate(()=>window.postMessage({channel:'chefworld-menu',revision:1,type:'export-png',pageIndex:0},'*'));
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.map((m:any)=>m.type))).toContain('png');
   const png=await page.evaluate(()=>(window as any).menuMessages.find((m:any)=>m.type==='png').dataUrl);
   expect(png.startsWith('data:image/png;base64,')).toBe(true);
   const dimensions=await page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();return[img.width,img.height];},png);
   expect(dimensions).toEqual([1632,2112]);
   await testInfo.attach(`${engine}-export`,{body:Buffer.from(png.split(',')[1],'base64'),contentType:'image/png'});
   const printHtml=buildMenuPrintHtml(ready.layout,draft,{fonts,artworkDataUrl:null});
   const printed=await browser.newPage();
   await printed.setContent(printHtml);await printed.evaluate(()=>document.fonts.ready);
   expect(await printed.locator('script').count()).toBe(0);
   expect(await printed.locator('.menu-page').count()).toBe(ready.pageCount);
   expect(await printed.locator('.menu-page text').evaluateAll(nodes=>nodes.map(node=>[node.textContent,node.getAttribute('x'),node.getAttribute('y')]))).toEqual(await page.locator('.menu-page text').evaluateAll(nodes=>nodes.map(node=>[node.textContent,node.getAttribute('x'),node.getAttribute('y')])));
   if(engine==='chromium'){
    const pdf=await printed.pdf({preferCSSPageSize:true,printBackground:true,path:testInfo.outputPath('chinese-menu.pdf')});
    expect(pdf.byteLength).toBeGreaterThan(10000);
    await testInfo.attach('chinese-menu-pdf',{body:pdf,contentType:'application/pdf'});
   }
   const changed={...draft,title:'Updated 中文 <script> & "',items:[draft.items[1]]};
   await page.evaluate(newDraft=>window.postMessage(JSON.stringify({channel:'chefworld-menu',revision:2,type:'render',draft:newDraft}),'*'),changed);
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='ready').map((m:any)=>m.revision))).toEqual([1,2]);
   await expect(page.locator('script')).toHaveCount(1);
   await expect(page.locator('[data-item-id="0"]')).toHaveCount(0);
   await page.evaluate(newDraft=>{
    window.postMessage({channel:'wrong',revision:3,type:'render',draft:newDraft},'*');
    window.postMessage({channel:'chefworld-menu',revision:1,type:'render',draft:newDraft},'*');
    window.postMessage({channel:'chefworld-menu',revision:1,type:'export-png',pageIndex:0},'*');
   },draft);
   await page.waitForTimeout(100);
   expect(await page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='ready').map((m:any)=>m.revision))).toEqual([1,2]);
   expect(await page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='png').length)).toBe(1);
   const artwork=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const context=canvas.getContext('2d')!;context.fillStyle='#ff00ff';context.fillRect(0,0,8,8);return canvas.toDataURL('image/png');});
   await page.evaluate(({newDraft,artwork})=>window.postMessage({channel:'chefworld-menu',revision:3,type:'render',draft:newDraft,assets:{artworkDataUrl:artwork}},'*'),{newDraft:changed,artwork});
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='ready').map((m:any)=>m.revision))).toEqual([1,2,3]);
   expect(await page.evaluate(()=>document.fonts.size)).toBe(5);
   await expect(page.locator('#menu-artwork')).toHaveCount(1);
   await page.evaluate(()=>window.postMessage({channel:'chefworld-menu',revision:3,type:'export-png',pageIndex:0},'*'));
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='png').length)).toBe(2);
   const artworkPixels=await page.evaluate(async()=>{
    const source=(window as any).menuMessages.filter((m:any)=>m.type==='png').at(-1).dataUrl;
    const img=new Image();img.src=source;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);
    return [Array.from(ctx.getImageData(10,10,1,1).data),Array.from(ctx.getImageData(140,1200,1,1).data)];
   });
   expect(artworkPixels).toEqual([[255,0,255,255],[251,245,232,255]]);

  } finally {await browser.close();}
 });
}

for(const engine of ['chromium','webkit'] as const){
 test(`${engine}: pending artwork survives a newer text-only revision`,async({},testInfo)=>{
  test.setTimeout(120_000);
  const browser=await (engine==='chromium'?chromium:webkit).launch();
  const page=await browser.newPage({viewport:{width:816,height:1056}});
  const input={...draft,items:[draft.items[1]]};
  try {
   await page.addInitScript(()=>{
    (window as any).menuMessages=[];
    window.addEventListener('menu-renderer-message',event=>(window as any).menuMessages.push((event as CustomEvent).detail));
   });
   await page.route('http://menu-race.test/',route=>route.fulfill({body:buildMenuPreviewHtml(input,{fonts,artworkDataUrl:null,revision:0}),contentType:'text/html'}));
   await page.goto('http://menu-race.test/');
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='ready').map((m:any)=>m.revision))).toEqual([0]);
   const artwork=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
    const context=canvas.getContext('2d')!;context.fillStyle='#ff00ff';context.fillRect(0,0,8,8);
    const artwork=canvas.toDataURL('image/png');
    const original=HTMLImageElement.prototype.decode;
    (window as any).pendingMenuDecodes=[];
    (window as any).restoreMenuDecode=()=>{HTMLImageElement.prototype.decode=original;};
    HTMLImageElement.prototype.decode=function(){
     if(this.src!==artwork)return original.call(this);
     return new Promise<void>((resolve,reject)=>(window as any).pendingMenuDecodes.push(()=>original.call(this).then(resolve,reject)));
    };
    return artwork;
   });
   await page.evaluate(({draft,artwork})=>window.postMessage({channel:'chefworld-menu',revision:1,type:'render',draft,assets:{artworkDataUrl:artwork}},'*'),{draft:input,artwork});
   await expect.poll(()=>page.evaluate(()=>(window as any).pendingMenuDecodes.length)).toBe(1);
   // Invalid commands must not replace requested assets or advance the accepted revision.
   await page.evaluate(newDraft=>{
    window.postMessage({channel:'chefworld-menu',revision:99,type:'render',draft:{...newDraft,items:[null]},assets:{artworkDataUrl:null}},'*');
    window.postMessage({channel:'chefworld-menu',revision:99,type:'render',draft:newDraft,assets:{artworkDataUrl:'https://invalid.example/art.png'}},'*');
    window.postMessage({channel:'chefworld-menu',revision:2,type:'render',draft:newDraft},'*');
   },{...input,title:'Newest title 中文'});
   await page.waitForTimeout(100); // Let both commands run while image decoding stays explicitly gated.
   expect(await page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='ready').map((m:any)=>m.revision))).toEqual([0]);
   await page.evaluate(()=>{(window as any).restoreMenuDecode();(window as any).pendingMenuDecodes.forEach((release:()=>void)=>release());});
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='ready').map((m:any)=>m.revision))).toEqual([0,2]);
   await expect(page.locator('#menu-artwork')).toHaveAttribute('href',artwork);
   await expect(page.locator('.menu-page use')).toHaveAttribute('href','#menu-artwork');
   await expect(page.locator('.menu-page text').first()).toHaveText('Newest title 中文');
   await page.evaluate(()=>window.postMessage({channel:'chefworld-menu',revision:2,type:'export-png',pageIndex:0},'*'));
   await expect.poll(()=>page.evaluate(()=>(window as any).menuMessages.filter((m:any)=>m.type==='png').length)).toBe(1);
   const pixel=await page.evaluate(async()=>{
    const img=new Image();img.src=(window as any).menuMessages.find((m:any)=>m.type==='png').dataUrl;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);
    return Array.from(ctx.getImageData(10,10,1,1).data);
   });
   expect(pixel).toEqual([255,0,255,255]);
   const ready=await page.evaluate(()=>(window as any).menuMessages.find((m:any)=>m.type==='ready'&&m.revision===2)) as Extract<MenuRendererMessage,{type:'ready'}>;
   const printPage=await browser.newPage({viewport:{width:816,height:1056}});
   await printPage.setContent(buildMenuPrintHtml(ready.layout,{...input,title:'Newest title 中文'},{fonts,artworkDataUrl:artwork}));
   await printPage.evaluate(()=>document.fonts.ready);
   await expect(printPage.locator('#menu-artwork')).toHaveAttribute('href',artwork);
   expect(await printPage.locator('.menu-page text').evaluateAll(nodes=>nodes.map(node=>[node.textContent,node.getAttribute('x'),node.getAttribute('y')]))).toEqual(await page.locator('.menu-page text').evaluateAll(nodes=>nodes.map(node=>[node.textContent,node.getAttribute('x'),node.getAttribute('y')])));
   await printPage.screenshot({path:testInfo.outputPath(`${engine}-artwork-race-print.png`)});
  }finally{await browser.close();}
 });
}
