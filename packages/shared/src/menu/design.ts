import type { MenuDesign, MenuDraft, MenuStyleId } from './types';

export function isMenuDesign(value: unknown): value is MenuDesign {
 if(!value || typeof value!=='object' || Array.isArray(value))return false;
 const d=value as Record<string,unknown>;
 const keys=['version','layout','palette','typography','columns','density','decorations','section_treatment','photo_frame','artwork_placement','art_direction','show_descriptions'];
 if(Object.keys(d).length!==keys.length || !keys.every(key=>Object.prototype.hasOwnProperty.call(d,key)))return false;
 const palette=d.palette as Record<string,unknown> | undefined;
 const type=d.typography as Record<string,unknown> | undefined;
 const member=(value:unknown,allowed:readonly string[])=>typeof value==='string'&&allowed.includes(value);
 return d.version===1 && typeof d.show_descriptions==='boolean' && member(d.layout,['photo-grid','illustrated-list','category-board']) &&
 !!palette && typeof palette==='object' && Object.keys(palette).length===5 && ['background','panel','text','accent','muted'].every(k=>typeof palette[k]==='string' && /^#[0-9a-fA-F]{6}$/.test(palette[k] as string)) &&
 !!type && typeof type==='object' && Object.keys(type).length===3 && member(type.title,['serif','sans','playful']) && member(type.body,['serif','sans']) && member(type.align,['left','center']) &&
 [1,2,3].includes(d.columns as number) && member(d.density,['airy','comfortable','compact']) && member(d.decorations,['minimal','balanced','expressive']) &&
 member(d.section_treatment,['plain','band','rule','pill']) && member(d.photo_frame,['none','rounded','circle']) &&
 member(d.artwork_placement,['header','sidebar','inset']) && typeof d.art_direction==='string' && Array.from(d.art_direction).length<=600;
}

/** Preserve the chosen ink when readable; otherwise move it only as far as
 * necessary toward a light or dark shade, without changing the surface. */
export function menuReadableForeground(preferred:string,surface:string):string {
 const channels=(color:string)=>[1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
 const luminance=(rgb:number[])=>{const c=rgb.map(value=>{const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 const foreground=channels(preferred),background=luminance(channels(surface));
 const contrast=(rgb:number[])=>{const light=luminance(rgb);return (Math.max(light,background)+.05)/(Math.min(light,background)+.05);};
 if(contrast(foreground)>=4.5)return preferred;
 const candidates:{rgb:number[];distance:number}[]=[];
 for(const target of [0,255]){
  const blend=(amount:number)=>foreground.map(channel=>Math.round(channel+(target-channel)*amount));
  if(contrast(blend(1))<4.5)continue;
  let low=0,high=1;
  for(let step=0;step<24;step++){const mid=(low+high)/2;if(contrast(blend(mid))>=4.5)high=mid;else low=mid;}
  const rgb=blend(high);candidates.push({rgb,distance:rgb.reduce((sum,value,index)=>sum+(value-foreground[index])**2,0)});
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 return '#'+candidates[0].rgb.map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();
}

export function menuDesignForStyle(styleId: MenuStyleId): MenuDesign {
 const palettes:Record<MenuStyleId,MenuDesign['palette']>={
  'cozy-cafe':{background:'#FFF0C8',panel:'#FFFCF2',text:'#493126',accent:'#BA514B',muted:'#8A6C58'},
  'french-bistro':{background:'#F8F1E4',panel:'#FFFCF5',text:'#421D26',accent:'#832D40',muted:'#886C6A'},
  'garden-table':{background:'#EAF0DD',panel:'#FFFCF0',text:'#304431',accent:'#597552',muted:'#72816A'},
  'italian-supper':{background:'#FFF0D8',panel:'#FFFDF5',text:'#452C22',accent:'#B73D2E',muted:'#90705B'},
  'chinese-teahouse':{background:'#F2E5C9',panel:'#FCF7EA',text:'#392C24',accent:'#A04435',muted:'#827255'},
  'minimal-modern':{background:'#F5F2EA',panel:'#FFFFFF',text:'#252926',accent:'#4D6458',muted:'#778177'},
 };
 const grid=styleId==='cozy-cafe'||styleId==='italian-supper';
 const board=styleId==='chinese-teahouse';
 return {version:1,layout:grid?'photo-grid':board?'category-board':'illustrated-list',palette:{...palettes[styleId]},
  typography:{title:styleId==='cozy-cafe'?'playful':styleId==='minimal-modern'?'sans':'serif',body:styleId==='french-bistro'?'serif':'sans',align:grid||board?'center':'left'},
  columns:2,density:'comfortable',decorations:styleId==='minimal-modern'?'minimal':grid?'expressive':'balanced',section_treatment:board?'band':grid?'pill':'rule',photo_frame:styleId==='garden-table'?'circle':'rounded',
  artwork_placement:styleId==='garden-table'?'sidebar':styleId==='french-bistro'?'inset':'header',art_direction:'',show_descriptions:true};
}

export function resolveMenuDesign(draft: Pick<MenuDraft,'styleId'|'design'>): MenuDesign {
 if(draft.design!==undefined){if(!isMenuDesign(draft.design))throw new Error('Invalid menu design');return draft.design;}
 return menuDesignForStyle(draft.styleId);
}
