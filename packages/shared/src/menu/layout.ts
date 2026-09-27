import type { MenuDesign, MenuDraft } from './types';
import { designedMenuLayout } from './designLayout';
import { MENU_STYLES_BY_ID, type MenuStylePreset } from './styles';

export type MenuTextRun = {
  itemId?: string; text: string; x: number; baseline: number; size: number;
  lineHeight: number; family: 'MenuSerif' | 'MenuSans' | 'MenuCJK' | 'MenuHand';
  weight: 400 | 600; color: string; align: 'left' | 'center' | 'right';
};
export type MenuGraphic =
 | {kind:'rect';x:number;y:number;width:number;height:number;fill:string;radius?:number;opacity?:number;stroke?:string;strokeWidth?:number}
 | {kind:'ellipse';x:number;y:number;rx:number;ry:number;fill:string;opacity?:number}
 | {kind:'line';x:number;y:number;x2:number;y2:number;stroke:string;strokeWidth:number;opacity?:number};
export type MenuPageImage = {recipeId:string;x:number;y:number;width:number;height:number;frame:'none'|'rounded'|'circle'};
export type MenuArtworkBox = {x:number;y:number;width:number;height:number;opacity?:number};
export type MenuPage = { runs: MenuTextRun[]; itemStarts: string[]; design?:MenuDesign; graphics?:MenuGraphic[]; images?:MenuPageImage[]; artwork?:MenuArtworkBox; pageIndex?:number };
export type MenuLayout = { width: 816; height: 1056; pages: MenuPage[] };
export type MenuTextMeasure = (text: string, font: Pick<MenuTextRun, 'size' | 'family' | 'weight'>) => number;

/** Self-contained: serialized into the WebView; keep all helpers inside this function. */
export function legacyMenuLayoutEngine(draft: MenuDraft, measure: MenuTextMeasure, style: MenuStylePreset): MenuLayout {
  const pages: MenuPage[] = [];
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale: undefined, options: {granularity:'grapheme'}) => {segment(text:string): Iterable<{segment:string}>} }).Segmenter;
  const segmenter = Segmenter ? new Segmenter(undefined, {granularity:'grapheme'}) : null;
  const graphemes = (text: string) => segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);
  type Font = Pick<MenuTextRun, 'size'|'family'|'weight'>;
  const wrap = (text: string, font: Font): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r\n?/g,'\n').split('\n')) {
      const chars = graphemes(paragraph);
      if (!chars.length) { lines.push(''); continue; }
      let start = 0;
      while (start < chars.length) {
        let end = start, wordBreak = start;
        while (end < chars.length && measure(chars.slice(start,end+1).join(''),font) <= 672) {
          if (/\s/u.test(chars[end])) wordBreak=end+1;
          end++;
        }
        // One unusually wide grapheme remains intact; ordinary glyphs fit the page at these fixed sizes.
        if (end === start) end++;
        else if (end < chars.length && wordBreak > start) end=wordBreak;
        lines.push(chars.slice(start,end).join(''));
        start=end;
      }
    }
    return lines;
  };
  const titleFont: Font={size:36,family:style.titleFamily,weight:600};
  const titleLines=wrap(draft.title,titleFont);
  let page: MenuPage, y=72;
  const addPage=()=>{
    page={runs:[],itemStarts:[]}; pages.push(page); y=72;
    if(pages.length>1 && draft.title){
      // The full title is flowed once below. A compact first-line running header repeats on continuations.
      const text=wrap(titleLines[0],{...titleFont,size:16})[0];
      page.runs.push({...titleFont,size:16,lineHeight:26,text,x:72,baseline:88,color:style.colors.accent,align:'left'});
      y=114;
    }
  };
  addPage();
  const ensure=(height:number)=>{if(y+height>960) addPage();};
  const line=(text:string,font:Font,lineHeight:number,color:string,align:MenuTextRun['align'],itemId?:string,startItem=false)=>{
    ensure(lineHeight);
    if(startItem) page.itemStarts.push(itemId!);
    page.runs.push({...font,text,lineHeight,color,align,itemId,x:align==='center'?408:align==='right'?744:72,baseline:y+font.size});
    y+=lineHeight;
  };
  for(const text of titleLines) line(text,titleFont,48,style.colors.text,style.titleAlign);
  if(draft.subtitle) for(const text of wrap(draft.subtitle,{size:16,family:style.bodyFamily,weight:400})) line(text,{size:16,family:style.bodyFamily,weight:400},26,style.colors.accent,style.titleAlign);
  y+=24;
  for(const section of draft.sections){
    const items=draft.items.filter(item=>item.sectionId===section.id);
    if(!items.length) continue;
    const nameFont:Font={size:20,family:style.bodyFamily,weight:600};
    const body:Font={size:16,family:style.bodyFamily,weight:400};
    const rows=items.map(item=>{
      const names=wrap(item.name,nameFont);
      const descriptions=item.description?wrap(item.description,body):[];
      return {item,names,descriptions,height:names.length*30+descriptions.length*25};
    });
    const freshPageHeight=960-(draft.title?114:72);
    const keepHeadingWithFirstRow=34+rows[0].height<=freshPageHeight;
    const sectionFont:Font={size:22,family:style.titleFamily,weight:600};
    const heading=wrap(section.title,sectionFont);
    for(let index=0;index<heading.length;index++){
      ensure(index===heading.length-1?(keepHeadingWithFirstRow?34+rows[0].height:64):34);
      line(heading[index],sectionFont,34,style.colors.accent,'left');
    }
    for(const [index,{item,names,descriptions,height}] of rows.entries()){
      // Ordinary dishes move as one block. Exceptionally long dishes still
      // flow line by line, keeping the first line beside its section heading.
      if(height<=freshPageHeight&&(index>0||keepHeadingWithFirstRow)) ensure(height);
      names.forEach((text,index)=>line(text,nameFont,30,style.colors.text,'left',item.recipeId,index===0));
      for(const text of descriptions) line(text,body,25,style.colors.text,'left',item.recipeId);
      y+=18;
    }
    y+=14;
  }
  pages.forEach((entry,index)=>entry.runs.push({text:`${index+1} / ${pages.length}`,x:408,baseline:1000,size:16,lineHeight:24,family:style.bodyFamily,weight:400,color:style.colors.accent,align:'center'}));
  return {width:816,height:1056,pages};
}
export function menuLayoutEngine(draft: MenuDraft, measure: MenuTextMeasure, style: MenuStylePreset): MenuLayout {
  return draft.design === undefined ? legacyMenuLayoutEngine(draft, measure, style) : designedMenuLayout(draft, measure);
}
export function layoutMenu(draft: MenuDraft, measure: MenuTextMeasure): MenuLayout {
  return menuLayoutEngine(draft,measure,MENU_STYLES_BY_ID[draft.styleId]);
}
