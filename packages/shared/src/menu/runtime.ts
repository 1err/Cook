import type { MenuDraft } from './types';
import type { MenuLayout, menuLayoutEngine } from './layout';
import type { MenuStylePreset } from './styles';
import type { menuPageSvg } from './pageSvg';

export type MenuFontAsset = {family:string;weight:number;dataUrl:string};
export type MenuRendererAssets = {fonts:MenuFontAsset[];artworkDataUrl:string|null};
export type MenuRendererCommand =
 | {channel:'chefworld-menu';revision:number;type:'render';draft:MenuDraft;assets?:Partial<MenuRendererAssets>}
 | {channel:'chefworld-menu';revision:number;type:'export-png';pageIndex:number};
export type MenuRendererMessage =
 | {channel:'chefworld-menu';revision:number;type:'ready';layout:MenuLayout;pageCount:number}
 | {channel:'chefworld-menu';revision:number;type:'png';pageIndex:number;dataUrl:string}
 | {channel:'chefworld-menu';revision:number;type:'error';code:'render-failed'|'export-failed';message:string};

/** No imports/closures are used by the serialized function. Browser and native receive initial ready automatically. */
export function menuRendererRuntime(
 initial:{draft:MenuDraft;assets:MenuRendererAssets;revision:number},
 styles:Record<string,MenuStylePreset>,
 layoutEngine:typeof menuLayoutEngine,
 pageSvg:typeof menuPageSvg,
) {
 const channel='chefworld-menu';
 let revision=-1, readyRevision=-1, draft=initial.draft, assets=initial.assets, layout:MenuLayout|null=null;
 // Requested state advances synchronously after validation; decoded resources can finish later.
 let requestedAssets=initial.assets;
 let loadedFontAssets:MenuFontAsset[]|null=null;
 const documentFonts=document.fonts as typeof document.fonts & {add(face:FontFace):void;delete(face:FontFace):void};
 let background:HTMLImageElement|null=null;
 let fontFaces:FontFace[]=[];
 const send=(payload:object)=>{
  const value={channel,revision,...payload};
  const native=(window as unknown as {ReactNativeWebView?:{postMessage:(message:string)=>void}}).ReactNativeWebView;
  if(native) native.postMessage(JSON.stringify(value));
  else if(window.parent!==window) window.parent.postMessage(value,'*');
  window.dispatchEvent(new CustomEvent('menu-renderer-message',{detail:value}));
 };
 const validFont=(font:MenuFontAsset)=>font && ['MenuSerif','MenuSans','MenuCJK'].includes(font.family) && [400,600].includes(font.weight) && typeof font.dataUrl==='string' && /^data:(?:font\/(?:otf|ttf|woff2?)|application\/(?:font-woff|x-font-ttf|x-font-opentype));base64,[A-Za-z0-9+/]+={0,2}$/.test(font.dataUrl);
 const validImage=(url:unknown)=>url===null || (typeof url==='string' && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(url));
 const validDraft=(input:MenuDraft)=>input && typeof input==='object' && Object.prototype.hasOwnProperty.call(styles,input.styleId) && ['title','subtitle'].every(key=>typeof input[key as keyof MenuDraft]==='string') && Array.isArray(input.sections) && input.sections.every(s=>s && typeof s.id==='string' && typeof s.title==='string') && Array.isArray(input.items) && input.items.every(i=>i && ['recipeId','sectionId','name','description'].every(key=>typeof i[key as keyof typeof i]==='string')) && new Set(input.items.map(i=>i.recipeId)).size===input.items.length && new Set(input.sections.map(s=>s.id)).size===input.sections.length && input.items.every(i=>input.sections.some(s=>s.id===i.sectionId));
 const canvas=document.createElement('canvas');
 const context=canvas.getContext('2d')!;
 const font=(run:{size:number;weight:number;family:string})=>`${run.weight} ${run.size}px "${run.family}", "MenuCJK", sans-serif`;
 const render=async(command:Extract<MenuRendererCommand,{type:'render'}>)=>{
  if(!validDraft(command.draft)) return;
  const nextAssets={...requestedAssets,...command.assets};
  if(!Array.isArray(nextAssets.fonts) || nextAssets.fonts.length>5 || !nextAssets.fonts.every(validFont) || !validImage(nextAssets.artworkDataUrl)) return;
  requestedAssets=nextAssets;
  revision=command.revision; readyRevision=-1;
  const thisRevision=revision;
  try {
   if(nextAssets.fonts!==loadedFontAssets){
    const loaded=await Promise.all(nextAssets.fonts.map(async asset=>{
     const face=new FontFace(asset.family,`url(${asset.dataUrl})`,{weight:String(asset.weight)});
     await face.load(); return face;
    }));
    if(revision!==thisRevision) return;
    fontFaces.forEach(face=>documentFonts.delete(face));
    loaded.forEach(face=>documentFonts.add(face)); fontFaces=loaded; loadedFontAssets=nextAssets.fonts;
   }
   let image=background;
   if(nextAssets.artworkDataUrl!==assets.artworkDataUrl || (!background && nextAssets.artworkDataUrl)){
    image=null;
    if(nextAssets.artworkDataUrl){image=new Image();image.src=nextAssets.artworkDataUrl;await image.decode();}
   }
   await document.fonts.ready;
   if(revision!==thisRevision) return;
   assets=nextAssets; draft=command.draft; background=image;
   layout=layoutEngine(draft,(text,run)=>{context.font=font(run);return context.measureText(text).width;},styles[draft.styleId]);
   const defs=document.getElementById('menu-artwork-def')!;
   defs.replaceChildren();
   if(assets.artworkDataUrl){
    const node=document.createElementNS('http://www.w3.org/2000/svg','image');
    node.id='menu-artwork';node.setAttribute('href',assets.artworkDataUrl);node.setAttribute('width','816');node.setAttribute('height','1056');node.setAttribute('preserveAspectRatio','xMidYMid slice');defs.append(node);
   }
   document.getElementById('menu-pages')!.innerHTML=layout.pages.map((page,index)=>`<section class="menu-page" data-page="${index}">${pageSvg(page,styles[draft.styleId],!!background)}</section>`).join('');
   readyRevision=revision; send({type:'ready',layout,pageCount:layout.pages.length});
  } catch { if(revision===thisRevision) send({type:'error',code:'render-failed',message:'Menu rendering failed.'}); }
 };
 const exportPng=async(pageIndex:number)=>{
  if(!layout || readyRevision!==revision || !Number.isInteger(pageIndex) || pageIndex<0 || pageIndex>=layout.pages.length) return;
  const thisRevision=revision;
  try {
   const output=document.createElement('canvas');output.width=1632;output.height=2112;
   const ctx=output.getContext('2d')!;ctx.scale(2,2);
   const style=styles[draft.styleId];
   ctx.fillStyle=style.colors.background;ctx.fillRect(0,0,816,1056);
   if(background){const scale=Math.max(816/background.width,1056/background.height);ctx.drawImage(background,(816-background.width*scale)/2,(1056-background.height*scale)/2,background.width*scale,background.height*scale);}
   else {const ornament=new Image();ornament.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(style.ornamentSvg);await ornament.decode();if(revision!==thisRevision)return;ctx.drawImage(ornament,0,0,816,1056);}
   ctx.fillStyle=style.colors.panel;ctx.beginPath();ctx.roundRect(56,56,704,972,6);ctx.fill();
   ctx.textBaseline='alphabetic';
   for(const run of layout.pages[pageIndex].runs){ctx.font=font(run);ctx.fillStyle=run.color;ctx.textAlign=run.align;ctx.fillText(run.text,run.x,run.baseline);}
   if(revision===thisRevision) send({type:'png',pageIndex,dataUrl:output.toDataURL('image/png')});
  }catch{if(revision===thisRevision)send({type:'error',code:'export-failed',message:'Menu export failed.'});}
 };
 const receive=(event:MessageEvent)=>{
  if(event.source && event.source!==window.parent && event.source!==window) return;
  let value=event.data;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{return;}}
  if(!value || typeof value!=='object' || value.channel!==channel || !Number.isSafeInteger(value.revision) || value.revision<0) return;
  if(value.type==='render' && value.revision>revision) void render(value);
  else if(value.type==='export-png' && value.revision===revision) void exportPng(value.pageIndex);
 };
 window.addEventListener('message',receive);document.addEventListener('message',receive as EventListener);
 void render({channel,type:'render',revision:initial.revision,draft:initial.draft,assets:initial.assets});
}
