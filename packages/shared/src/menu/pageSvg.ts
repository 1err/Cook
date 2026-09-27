import type { MenuPage } from './layout';
import type { MenuStylePreset } from './styles';
/** Preview and script-free print share exact measured geometry and text baselines. */
export function menuPageSvg(page:MenuPage,style:MenuStylePreset,hasArtwork:boolean,itemImages:Record<string,string>={},artworkDataUrl?:string|null):string {
 const escape=(text:string)=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const number=(value:number)=>Number.isFinite(value)?value:0;
 const color=(value:string)=>/^#[0-9a-fA-F]{6}$/.test(value)?value:'#302C28';
 const ornament=style.ornamentSvg.replace(/<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
 const text=page.runs.map(run=>`<text xml:space="preserve" x="${number(run.x)}" y="${number(run.baseline)}" font-size="${number(run.size)}" font-family="${escape(run.family)},MenuCJK,sans-serif" font-weight="${number(run.weight)}" fill="${color(run.color)}" text-anchor="${run.align==='center'?'middle':run.align==='right'?'end':'start'}"${run.itemId?` data-item-id="${escape(run.itemId)}"`:''}>${escape(run.text)}</text>`).join('');
 if(!page.design)return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 816 1056" width="816" height="1056" role="img"><rect width="816" height="1056" fill="${style.colors.background}"/>${hasArtwork?'<use href="#menu-artwork"/>':ornament}<rect x="56" y="56" width="704" height="972" rx="6" fill="${style.colors.panel}"/>${text}</svg>`;
 const graphics=(page.graphics??[]).map(g=>{
  const opacity=g.opacity===undefined?1:Math.max(0,Math.min(1,number(g.opacity)));
  if(g.kind==='rect')return `<rect x="${number(g.x)}" y="${number(g.y)}" width="${number(g.width)}" height="${number(g.height)}" rx="${number(g.radius??0)}" fill="${color(g.fill)}" opacity="${opacity}"${g.stroke?` stroke="${color(g.stroke)}" stroke-width="${number(g.strokeWidth??1)}"`:''}/>`;
  if(g.kind==='ellipse')return `<ellipse cx="${number(g.x)}" cy="${number(g.y)}" rx="${number(g.rx)}" ry="${number(g.ry)}" fill="${color(g.fill)}" opacity="${opacity}"/>`;
  return `<line x1="${number(g.x)}" y1="${number(g.y)}" x2="${number(g.x2)}" y2="${number(g.y2)}" stroke="${color(g.stroke)}" stroke-width="${number(g.strokeWidth)}" opacity="${opacity}"/>`;
 }).join('');
 const photos=(page.images??[]).map((image,index)=>{
  const data=Object.prototype.hasOwnProperty.call(itemImages,image.recipeId)?itemImages[image.recipeId]:undefined;
  if(typeof data!=='string'||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data))return '';
  const x=number(image.x),y=number(image.y),width=number(image.width),height=number(image.height);
  const id=`menu-photo-${number(page.pageIndex??0)}-${index}`;
  const clip=image.frame==='circle'?`<ellipse cx="${x+width/2}" cy="${y+height/2}" rx="${width/2}" ry="${height/2}"/>`:`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${image.frame==='rounded'?12:0}"/>`;
  return `<defs><clipPath id="${id}">${clip}</clipPath></defs><image data-recipe-image="${escape(image.recipeId)}" href="${data}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
 }).join('');
 const box=page.artwork;
 const artwork=hasArtwork&&box&&typeof artworkDataUrl==='string'&&/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(artworkDataUrl)?`<image data-menu-artwork="true" href="${artworkDataUrl}" x="${number(box.x)}" y="${number(box.y)}" width="${number(box.width)}" height="${number(box.height)}" preserveAspectRatio="xMidYMid slice" opacity="${number(box.opacity??1)}"/>`:'';
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 816 1056" width="816" height="1056" role="img" data-layout="${escape(page.design.layout)}"><rect width="816" height="1056" fill="${color(page.design.palette.background)}"/>${artwork}${graphics}${photos}${text}</svg>`;
}
