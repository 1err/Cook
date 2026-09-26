import type { MenuDraft } from './types';
import { MENU_STYLES_BY_ID } from './styles';
import type { MenuLayout } from './layout';
import { menuPageSvg } from './pageSvg';
import type { MenuRendererAssets } from './runtime';
import { MENU_RUNTIME_SOURCE } from './runtimeSource';

function validateAssets(assets:MenuRendererAssets):void {
 if(assets.artworkDataUrl!==null && !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(assets.artworkDataUrl)) throw new Error('Invalid menu artwork');
 if(assets.fonts.length>5 || assets.fonts.some(font=>!['MenuSerif','MenuSans','MenuCJK'].includes(font.family) || ![400,600].includes(font.weight) || !/^data:(?:font\/(?:otf|ttf|woff2?)|application\/(?:font-woff|x-font-ttf|x-font-opentype));base64,[A-Za-z0-9+/]+={0,2}$/.test(font.dataUrl))) throw new Error('Invalid menu font');
}
const json=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const baseCss=`*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:#e8e5df}.menu-page{width:816px;height:1056px;margin:0 auto 24px;overflow:hidden;break-after:page;page-break-after:always}.menu-page:last-child{break-after: auto;page-break-after:auto;margin-bottom:0}.menu-page>svg{display:block;width:816px;height:1056px}svg text{white-space:pre;font-kerning:auto}#menu-definitions{position:absolute;width:0;height:0;overflow:hidden}@page { size: 8.5in 11in; margin: 0 }@media print{html,body{width:816px;background:white}.menu-page{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
const shell=(css:string,body:string,script='')=>`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src ${script ? "'unsafe-inline'" : "'none'"}; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><meta name="viewport" content="width=816"><title>Menu</title><style>${baseCss}${css}</style></head><body>${body}${script}</body></html>`;
const definitions=(artwork:string|null)=>`<svg id="menu-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs id="menu-artwork-def">${artwork?`<image id="menu-artwork" href="${artwork}" width="816" height="1056" preserveAspectRatio="xMidYMid slice"/>`:''}</defs></svg>`;

/** Assets are embedded once. Future render commands omit assets unless their bytes changed. */
export function buildMenuPreviewHtml(draft:MenuDraft,assets:MenuRendererAssets & {revision:number}):string {
 validateAssets(assets);
 if(!Number.isSafeInteger(assets.revision) || assets.revision<0)throw new Error('Invalid menu revision');
 const initial={draft,assets:{fonts:assets.fonts,artworkDataUrl:assets.artworkDataUrl},revision:assets.revision};
 // A generated standalone source string survives native/web bundler rewriting.
 return shell('',definitions(null)+'<main id="menu-pages"></main>',`<script>${MENU_RUNTIME_SOURCE}\nstartMenuRenderer(${json(initial)},${json(MENU_STYLES_BY_ID)});</script>`);
}

/** Uses the canonical measured layout received in ready; printing never reflows text. */
export function buildMenuPrintHtml(layout:MenuLayout,draft:MenuDraft,assets:MenuRendererAssets):string {
 validateAssets(assets);
 const css=assets.fonts.map(font=>`@font-face{font-family:${font.family};font-style:normal;font-weight:${font.weight};src:url(${font.dataUrl})}`).join('');
 return shell(css,definitions(assets.artworkDataUrl)+layout.pages.map((page,index)=>`<section class="menu-page" data-page="${index}">${menuPageSvg(page,MENU_STYLES_BY_ID[draft.styleId],!!assets.artworkDataUrl)}</section>`).join(''));
}
