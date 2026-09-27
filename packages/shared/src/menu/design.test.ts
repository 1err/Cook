import { describe, expect, it } from 'vitest';
import { createMenuDraft, reconcileMenuSelection, updateMenuItem } from './draft';
import { layoutMenu } from './layout';
import { buildMenuPrintHtml, buildMenuPreviewHtml } from './html';
import type { MenuDraft } from './types';
import { isMenuDesign } from './design';

const design = {
 version:1, layout:'photo-grid', show_descriptions:true, palette:{background:'#FFF2D4',panel:'#FFFBF0',text:'#402E28',accent:'#B54D42',muted:'#896F5D'},
 typography:{title:'playful',body:'sans',align:'center'}, columns:2,density:'comfortable',decorations:'expressive',
 section_treatment:'pill',photo_frame:'rounded',artwork_placement:'header',art_direction:'Warm hand-drawn kitchen doodles',
} as const;
const recipes=Array.from({length:12},(_,i)=>({id:`r${i}`,title:`Dish ${i}`,description:'A lovely dish',thumbnail_url:`https://images.test/${i}.png`}));
const base:MenuDraft={title:'Our kitchen',subtitle:'Made with love',instructions:'',styleId:'cozy-cafe',sections:[{id:'dishes',title:'Dishes'}],items:recipes.map(r=>({recipeId:r.id,sectionId:'dishes',name:r.title,description:r.description,imageUrl:r.thumbnail_url,price:'$12',badge:'House favorite'})),artwork:null};
const measure=(text:string,{size}:{size:number})=>Array.from(text).length*size*.52;
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tQAAAABJRU5ErkJggg==';

describe('designed restaurant menus',()=>{
 it('groups category headings and dishes in continuous panels that split at page and column boundaries',()=>{
  const input={...base,design:{...design,layout:'category-board' as const,section_treatment:'plain' as const},sections:[{id:'dishes',title:'Our dishes'}]};
  const result=layoutMenu(input,measure);
  expect(result.pages.flatMap(page=>page.itemStarts)).toEqual(recipes.map(recipe=>recipe.id));
  let panelCount=0;
  for(const page of result.pages){
   const panels=page.graphics!.filter(shape=>shape.kind==='rect'&&shape.width===353&&shape.fill===design.palette.panel);
   panelCount+=panels.length;
   for(const panel of panels)if(panel.kind==='rect'){
    expect(panel.stroke).toBeUndefined();
    expect(panel.y+panel.height).toBeLessThanOrEqual(968);
   }
   for(const run of page.runs.filter(run=>run.itemId)){
    expect(panels.filter(panel=>panel.kind==='rect'&&run.x>=panel.x&&run.x<=panel.x+panel.width&&run.baseline>=panel.y&&run.baseline<=panel.y+panel.height)).toHaveLength(1);
   }
  }
  expect(panelCount).toBeLessThan(recipes.length);
  const heading=result.pages[0].runs.find(run=>run.text==='Our dishes')!;
  const firstPanel=result.pages[0].graphics!.find(shape=>shape.kind==='rect'&&shape.width===353)!;
  expect(heading.baseline).toBeGreaterThan(firstPanel.y);
 });
 it('reclaims unused artwork space and reserves it only for accepted artwork',()=>{
  for(const placement of ['header','sidebar','inset'] as const){
   const plain={...base,design:{...design,artwork_placement:placement}};
   const accepted={...plain,artwork:{requestId:'accepted-art',styleId:'cozy-cafe' as const,instructions:''}};
   const noArt=layoutMenu(plain,measure),withArt=layoutMenu(accepted,measure);
   expect(noArt.pages.every(page=>page.artwork===undefined)).toBe(true);
   expect(withArt.pages[0].artwork).toBeDefined();
   expect(noArt.pages.flatMap(page=>page.itemStarts)).toEqual(recipes.map(recipe=>recipe.id));
   if(placement==='sidebar')expect(noArt.pages[0].images![0].width).toBeGreaterThan(withArt.pages[0].images![0].width);
   if(placement==='header')expect(noArt.pages[0].images![0].y).toBeLessThan(withArt.pages[0].images![0].y);
  }
 });
 it('keeps wrapped section headings inside one continuous pill or band when they fit',()=>{
  for(const treatment of ['pill','band'] as const){
   const input={...base,design:{...design,layout:'illustrated-list' as const,section_treatment:treatment},sections:[{id:'dishes',title:'Kitchen favorites and comforting classics 招牌菜'}]};
   const page=layoutMenu(input,measure).pages[0];
   const headings=page.runs.filter(run=>!run.itemId&&run.family==='MenuHand'&&run.size===22);
   const panels=page.graphics!.filter(shape=>shape.kind==='rect'&&shape.fill===design.palette.accent);
   expect(headings.length).toBeGreaterThan(1);
   expect(panels).toHaveLength(1);
   const panel=panels[0];
   if(panel.kind==='rect')expect(panel.y+panel.height).toBeGreaterThan(headings[headings.length-1].baseline);
  }
 });
 it('rejects array-valued enum fields instead of coercing malformed designs to strings',()=>{
  expect(isMenuDesign(design)).toBe(true);
  for(const key of ['layout','density','decorations','section_treatment','photo_frame','artwork_placement'] as const){
   expect(isMenuDesign({...design,[key]:[design[key]]})).toBe(false);
  }
  for(const key of ['title','body','align'] as const){
   expect(isMenuDesign({...design,typography:{...design.typography,[key]:[design.typography[key]]}})).toBe(false);
  }
 });
 it('keeps manual palette fills while giving every text role readable ink on its actual surface',()=>{
  const contrast=(a:string,b:string)=>{
   const luminance=(color:string)=>{const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
   const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  };
  for(const layout of ['photo-grid','illustrated-list','category-board'] as const){
   const palette={background:'#000000',panel:'#FFFFFF',text:'#000000',muted:'#000000',accent:'#FFFFFF'};
   const result=layoutMenu({...base,design:{...design,layout,palette}},measure);
   const first=result.pages[0],runs=result.pages.flatMap(p=>p.runs);
   expect(first.design?.palette).toEqual(palette);
   for(const run of runs.filter(r=>r.itemId))expect(contrast(run.color,layout==='illustrated-list'?palette.background:palette.panel)).toBeGreaterThanOrEqual(4.5);
   const title=first.runs.find(r=>r.text==='Our kitchen')!;
   expect(title.color).toBe('#000000'); // Already readable on the white header panel.
   const heading=first.runs.find(r=>r.text==='Dishes')!;
   expect(contrast(heading.color,palette.accent)).toBeGreaterThanOrEqual(4.5);
   const footer=first.runs[first.runs.length-1];
   expect(contrast(footer.color,palette.background)).toBeGreaterThanOrEqual(4.5);
  }
 });
 it('hides descriptions without deleting their editable text and restores them when enabled',()=>{
  const hidden={...base,design:{...design,show_descriptions:false}};
  const visible={...hidden,design:{...hidden.design,show_descriptions:true}};
  const content=(input:MenuDraft)=>layoutMenu(input,measure).pages.flatMap(p=>p.runs).filter(r=>r.itemId==='r0').map(r=>r.text).join('');
  expect(content(hidden)).toBe('Dish 0$12House favorite');
  expect(content(visible)).toBe('Dish 0A lovely dish$12House favorite');
  expect(hidden.items[0].description).toBe('A lovely dish');
 });
 it('snapshots recipe photos and preserves photo, price, badge, and design edits when selection changes',()=>{
  const initial=createMenuDraft(recipes,['r0'],{title:'Menu',section:'Dishes'});
  expect(initial.design?.layout).toBe('photo-grid');
  expect(initial.items[0].imageUrl).toBe('https://images.test/0.png');
  const edited=updateMenuItem(initial,'r0',{imageUrl:null,price:'$9',badge:'Favorite'});
  const next=reconcileMenuSelection(edited,recipes,['r0','r1']);
  expect(next.items[0]).toMatchObject({imageUrl:null,price:'$9',badge:'Favorite'});
  expect(next.design).toEqual(edited.design);
  expect(next.items[1].imageUrl).toBe('https://images.test/1.png');
 });
 it.each(['photo-grid','illustrated-list','category-board'] as const)('gives %s photos, editable prices, and distinct canonical page geometry',layout=>{
  const result=layoutMenu({...base,design:{...design,layout}},measure);
  expect(result.pages.flatMap(p=>p.itemStarts)).toEqual(recipes.map(r=>r.id));
  expect(result.pages.flatMap(p=>p.images??[]).map(i=>i.recipeId)).toEqual(recipes.map(r=>r.id));
  expect(result.pages.flatMap(p=>p.runs).filter(r=>r.text==='$12')).toHaveLength(12);
  expect(result.pages[0].graphics?.length).toBeGreaterThan(1);
  expect(result.pages[0].design?.layout).toBe(layout);
  const image=result.pages[0].images![0];
  const name=result.pages[0].runs.find(r=>r.itemId==='r0'&&r.text==='Dish 0')!;
  if(layout==='photo-grid')expect(image.y+image.height).toBeLessThan(name.baseline);
  else expect(image.x+image.width).toBeLessThanOrEqual(name.x);
 });
 it.each([1,2,3] as const)('flows all dishes into %i columns without losing long CJK or graphemes',columns=>{
  const name='香菇豆腐👩🏽‍🍳'.repeat(250);
  const description='美味的晚餐。'.repeat(350);
  const result=layoutMenu({...base,design:{...design,columns},items:[{...base.items[0],name,description,price:'',badge:''},...base.items.slice(1)]},measure);
  expect(result.pages.flatMap(p=>p.itemStarts)).toEqual(recipes.map(r=>r.id));
  expect(result.pages.flatMap(p=>p.runs).filter(r=>r.itemId==='r0').map(r=>r.text).join('')).toBe(name+description);
  for(const page of result.pages){
   for(const run of page.runs){
    expect(run.baseline).toBeLessThanOrEqual(1012);
    expect(run.x).toBeGreaterThanOrEqual(32);
    if(run.itemId){expect(run.baseline-run.size).toBeGreaterThanOrEqual(36);expect(measure(run.text,run)).toBeLessThanOrEqual(728/columns);}
   }
   for(const image of page.images??[])expect(image.y+image.height).toBeLessThanOrEqual(972);
  }
 });
 it('embeds actual PNG item photos in script-free print and escapes hostile text and IDs',()=>{
  const hostile='r0\"><script>alert(1)</script>';
  const draft={...base,design,items:[{...base.items[0],recipeId:hostile,name:'<img onerror="boom">',price:'<b>$8</b>',badge:'A & B'}]};
  const assets={fonts:[],artworkDataUrl:png,itemImages:{[hostile]:png}};
  const layout=layoutMenu(draft,measure);
  const html=buildMenuPrintHtml(layout,draft,assets);
  expect(html).toContain(png);
  expect(html.match(/<image /g)?.length).toBeGreaterThanOrEqual(2);
  expect(html).not.toMatch(/<script|<img onerror|<b>/);
  expect(html).toContain('&lt;b&gt;$8&lt;/b&gt;');
  expect(html).toContain('A &amp; B');
  for(const run of layout.pages[0].runs)expect(html).toContain(`y="${run.baseline}"`);
 });
 it('accepts the sixth handwriting font and rejects hostile item images and design colors',()=>{
  const fonts=Array.from({length:6},(_,i)=>({family:i===5?'MenuHand':'MenuSans',weight:400,dataUrl:'data:font/ttf;base64,AA=='}));
  expect(()=>buildMenuPreviewHtml({...base,design},{fonts,artworkDataUrl:null,itemImages:{r0:png},revision:0})).not.toThrow();
  for(const image of ['https://evil.test/photo','data:image/svg+xml;base64,PHN2Zz4='])expect(()=>buildMenuPreviewHtml({...base,design},{fonts:[],artworkDataUrl:null,itemImages:{r0:image},revision:0})).toThrow();
  expect(()=>buildMenuPreviewHtml({...base,design:{...design,palette:{...design.palette,accent:'red" onload="boom'}}},{fonts:[],artworkDataUrl:null,revision:0})).toThrow();
 });
 it('keeps photos and dish text separate across every composition and column count',()=>{
  for(const layout of ['photo-grid','illustrated-list','category-board'] as const)for(const columns of [1,2,3] as const){
   const input={...base,design:{...design,layout,columns,artwork_placement:'sidebar' as const},items:base.items.map((item,index)=>({...item,name:`Dish ${index} 豆腐`,description:'A long description with 中文文字. '.repeat(index%4+1)}))};
   const result=layoutMenu(input,measure);
   expect(result.pages.flatMap(p=>p.itemStarts)).toEqual(recipes.map(r=>r.id));
   for(const page of result.pages){
    const text=page.runs.filter(r=>r.itemId&&r.text);
    const box=(run:typeof text[number])=>{const w=measure(run.text,run);return {x:run.x-(run.align==='right'?w:run.align==='center'?w/2:0),y:run.baseline-run.size,w,h:run.size*1.2};};
    const overlaps=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)+.01&&Math.min(a.y+a.h,b.y+b.h)>Math.max(a.y,b.y)+.01;
    for(let i=0;i<text.length;i++)for(let j=i+1;j<text.length;j++)expect(overlaps(box(text[i]),box(text[j])),`${layout}/${columns}: ${text[i].text} overlaps ${text[j].text}`).toBe(false);
    for(const photo of page.images??[])for(const run of text)expect(overlaps({x:photo.x,y:photo.y,w:photo.width,h:photo.height},box(run)),`${layout}/${columns}: image covers ${run.text}`).toBe(false);
   }
  }
 });
});
