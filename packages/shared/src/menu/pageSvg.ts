import type { MenuPage } from './layout';
import type { MenuStylePreset } from './styles';
/** The preview and script-free print share these exact SVG text baselines. No foreignObject/CSS text layout. */
export function menuPageSvg(page: MenuPage, style: MenuStylePreset, hasArtwork: boolean): string {
  const escape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const ornament=style.ornamentSvg.replace(/<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
  const text=page.runs.map(run=>`<text xml:space="preserve" x="${run.x}" y="${run.baseline}" font-size="${run.size}" font-family="${run.family},MenuCJK,sans-serif" font-weight="${run.weight}" fill="${run.color}" text-anchor="${run.align==='center'?'middle':run.align==='right'?'end':'start'}"${run.itemId?` data-item-id="${escape(run.itemId)}"`:''}>${escape(run.text)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 816 1056" width="816" height="1056" role="img"><rect width="816" height="1056" fill="${style.colors.background}"/>${hasArtwork?'<use href="#menu-artwork"/>':ornament}<rect x="56" y="56" width="704" height="972" rx="6" fill="${style.colors.panel}"/>${text}</svg>`;
}
