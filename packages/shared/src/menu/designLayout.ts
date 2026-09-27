import type { MenuDraft } from './types';
import type { MenuGraphic, MenuLayout, MenuPage, MenuTextMeasure, MenuTextRun } from './layout';
import { resolveMenuDesign, menuReadableForeground } from './design';

/** Geometry is measured once and consumed unchanged by SVG, canvas, and print. */
export function designedMenuLayout(draft:MenuDraft,measure:MenuTextMeasure):MenuLayout {
 const design=resolveMenuDesign(draft), colors=design.palette, pages:MenuPage[]=[];
 type Font=Pick<MenuTextRun,'size'|'family'|'weight'>;
 type Row={text:string;font:Font;height:number;color:string;align?:'left'|'right'};
 const Segmenter=(Intl as typeof Intl & {Segmenter?:new(locale:undefined,options:{granularity:'grapheme'})=>{segment(text:string):Iterable<{segment:string}>}}).Segmenter;
 const segmenter=Segmenter?new Segmenter(undefined,{granularity:'grapheme'}):null;
 const wrap=(text:string,font:Font,width:number):string[]=>{
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
   const chars=segmenter?Array.from(segmenter.segment(paragraph),p=>p.segment):Array.from(paragraph);
   if(!chars.length){lines.push('');continue;}
   for(let start=0;start<chars.length;){
    let end=start,space=start;
    while(end<chars.length && measure(chars.slice(start,end+1).join(''),font)<=width){if(/\s/u.test(chars[end]))space=end+1;end++;}
    if(end===start)end++;else if(end<chars.length&&space>start)end=space;
    lines.push(chars.slice(start,end).join(''));start=end;
   }
  }
  return lines;
 };
 const grid=design.layout==='photo-grid', board=design.layout==='category-board';
 const hasArtwork=!!draft.artwork;
 const airy=design.density==='airy',compact=design.density==='compact';
 const margin=44,bottom=968,gap=compact?16:airy?28:22;
 const width=hasArtwork&&design.artwork_placement==='sidebar'?540:728;
 const columnWidth=(width-gap*(design.columns-1))/design.columns;
 const bodyFamily:MenuTextRun['family']=design.typography.body==='serif'?'MenuSerif':'MenuSans';
 const titleFamily:MenuTextRun['family']=design.typography.title==='playful'?'MenuHand':design.typography.title==='serif'?'MenuSerif':'MenuSans';
 const titleWeight=titleFamily==='MenuHand'?400:600;
 const inkCache=new Map<string,string>();
 const ink=(color:string,surface:string)=>{const key=color+'|'+surface;let value=inkCache.get(key);if(!value){value=menuReadableForeground(color,surface);inkCache.set(key,value);}return value;};
 let page!:MenuPage,y=44,pageTop=44,col=0,rowHeight=0;
 const graphic=(value:MenuGraphic)=>page.graphics!.push(value);
 const run=(text:string,font:Font,x:number,baseline:number,color:string,align:MenuTextRun['align']='left',itemId?:string,height=font.size*1.35,surface=colors.background)=>page.runs.push({...font,text,x,baseline,color:ink(color,surface),align,itemId,lineHeight:height});
 const addPage=()=>{
  page={runs:[],itemStarts:[],graphics:[],images:[],design,pageIndex:pages.length};pages.push(page);col=0;rowHeight=0;y=44;
  if(hasArtwork)page.artwork=design.artwork_placement==='header'?{x:0,y:0,width:816,height:pages.length>1?84:190,opacity:.9}:design.artwork_placement==='sidebar'?{x:604,y:40,width:180,height:916,opacity:.95}:{x:596,y:36,width:176,height:pages.length>1?48:176,opacity:.95};
  if(design.decorations!=='minimal'){
   const expressive=design.decorations==='expressive';
   for(const [x,cy] of [[24,260],[790,340],[24,880],[788,934]]){
    graphic({kind:'ellipse',x,y:cy,rx:expressive?10:5,ry:expressive?10:5,fill:colors.accent,opacity:.5});
    if(expressive)for(const [dx,dy] of [[0,-15],[15,0],[0,15],[-15,0]])graphic({kind:'ellipse',x:x+dx,y:cy+dy,rx:6,ry:6,fill:colors.accent,opacity:.28});
   }
  }
  graphic({kind:'line',x:margin,y:986,x2:margin+width,y2:986,stroke:colors.accent,strokeWidth:1,opacity:.4});
  if(pages.length>1){
   const font:Font={size:17,family:titleFamily,weight:titleWeight};
   const text=wrap(draft.title,font,width-28)[0]??'';
   graphic({kind:'rect',x:margin-8,y:36,width:width+16,height:44,fill:colors.panel,radius:10});
   run(text,font,margin,64,colors.accent,'left',undefined,26,colors.panel);y=100;
  }
  pageTop=y;
 };
 addPage();
 const titleSize=grid?54:board?48:46;
 const titleFont:Font={size:titleSize,family:titleFamily,weight:titleWeight};
 const headerWidth=hasArtwork&&design.artwork_placement==='inset'?width-200:width;
 const headerLine=(text:string,font:Font,height:number,color:string)=>{
  if(y+height>bottom)addPage();
  graphic({kind:'rect',x:margin-10,y:y-5,width:headerWidth+20,height:height+9,fill:colors.panel,radius:12});
  run(text,font,design.typography.align==='center'?margin+headerWidth/2:margin,y+font.size,color,design.typography.align,undefined,height,colors.panel);y+=height;
 };
 for(const text of wrap(draft.title,titleFont,headerWidth))headerLine(text,titleFont,titleSize*1.25,colors.text);
 const subtitleFont:Font={size:16,family:bodyFamily,weight:400};
 if(draft.subtitle)for(const text of wrap(draft.subtitle,subtitleFont,headerWidth))headerLine(text,subtitleFont,25,colors.muted);
 y=hasArtwork?Math.max(y+30,design.artwork_placement==='sidebar'?174:214):y+30;pageTop=y;
 if(y+80>bottom){addPage();pageTop=y;}
 const nextColumn=()=>{col++;rowHeight=0;if(col>=design.columns)addPage();else y=pageTop;};
 const flushGridRow=()=>{if(grid&&col>0){y+=rowHeight+gap;col=0;rowHeight=0;}};
 const reserve=(height:number)=>{
  if(y+height<=bottom)return;
  if(grid){flushGridRow();if(y+height>bottom)addPage();}
  else nextColumn();
 };
 const finishBlock=(height:number)=>{
  if(grid){rowHeight=Math.max(rowHeight,height);col++;if(col>=design.columns){y+=rowHeight+gap;col=0;rowHeight=0;}}
  else y+=height+gap;
 };
 const pad=compact?12:16;
 const nameFont:Font={size:design.columns===3?19:compact?21:grid?22:24,family:bodyFamily,weight:600};
 const bodyFont:Font={size:compact?13:airy?16:grid||design.columns===3?14:16,family:bodyFamily,weight:400};
 const metaFont:Font={size:14,family:bodyFamily,weight:600};
 let sectionCount=0;
 for(const section of draft.sections){
  const items=draft.items.filter(item=>item.sectionId===section.id);if(!items.length)continue;
  if(grid)flushGridRow();else if(board&&sectionCount>0)nextColumn();
  sectionCount++;
  let categoryPanel:{page:MenuPage;column:number;shape:Extract<MenuGraphic,{kind:'rect'}>}|undefined;
  const extendCategoryPanel=(end:number)=>{
   if(!board)return;
   if(!categoryPanel||categoryPanel.page!==page||categoryPanel.column!==col){
    const shape:Extract<MenuGraphic,{kind:'rect'}>={kind:'rect',x:margin+col*(columnWidth+gap),y,width:columnWidth,height:end-y,fill:colors.panel,radius:18};
    categoryPanel={page,column:col,shape};graphic(shape);
   }else categoryPanel.shape.height=Math.max(categoryPanel.shape.height,end-categoryPanel.shape.y);
  };
  const sectionWidth=grid?width:columnWidth;
  const sectionFont:Font={size:board?23:22,family:titleFamily,weight:titleWeight};
  const headingLines=wrap(section.title,sectionFont,sectionWidth-24);
  const drawHeading=(lines:string[])=>{
   const x=margin+col*(columnWidth+gap);
   const treatment=design.section_treatment;
   const height=lines.length*48;
   extendCategoryPanel(y+height);
   if(treatment==='band'||treatment==='pill')graphic({kind:'rect',x,y,width:sectionWidth,height:height-11,fill:colors.accent,radius:treatment==='pill'?18:3,opacity:1});
   if(treatment==='rule')graphic({kind:'line',x,y:y+height-11,x2:x+sectionWidth,y2:y+height-11,stroke:colors.accent,strokeWidth:2});
   const align=board?'center':design.typography.align;
   for(let index=0;index<lines.length;index++)run(lines[index],sectionFont,align==='center'?x+sectionWidth/2:x+12,y+26+index*48,treatment==='band'||treatment==='pill'?colors.panel:colors.accent,align,undefined,44,treatment==='band'||treatment==='pill'?colors.accent:board?colors.panel:colors.background);
   y+=height;
  };
  const headingHeight=headingLines.length*48,keepWithDish=Math.min(260,bottom-pageTop);
  if(headingHeight+keepWithDish<=bottom-pageTop){
   reserve(headingHeight+keepWithDish);drawHeading(headingLines);
  }else{
   // Oversized headings still paginate without losing text.
   for(let index=0;index<headingLines.length;index++){
    reserve(index===headingLines.length-1?keepWithDish:44);drawHeading([headingLines[index]]);
   }
  }
  // Each board column is a category; photo grids use an even row rhythm.
  for(const item of items){
   const hasPhoto=!!item.imageUrl;
   const photoWidth=grid?columnWidth-2*pad:Math.min(board?70:94,columnWidth*.29);
   const photoHeight=grid?Math.min(design.columns===1?220:design.columns===3?126:148,photoWidth*(design.photo_frame==='circle'?1:.72)):photoWidth;
   const sideOffset=!grid&&hasPhoto?photoWidth+14:0;
   const textWidth=columnWidth-2*pad-sideOffset;
   const rows:Row[]=[];
   const push=(text:string,font:Font,color:string,align?:'left'|'right')=>{for(const line of wrap(text,font,textWidth))rows.push({text:line,font,height:font.size*(airy?1.55:1.4),color,align});};
   push(item.name,nameFont,colors.text);
   if(design.show_descriptions && item.description)push(item.description,bodyFont,colors.muted);
   if(item.price)push(item.price,metaFont,colors.accent,'right');
   if(item.badge)push(item.badge,{...metaFont,size:12},colors.accent);
   let offset=0,first=true;
   while(offset<rows.length){
    const photoTop=first&&hasPhoto&&grid?photoHeight+14:0;
    const imageMin=first&&hasPhoto&&!grid?photoHeight:0;
    const fullHeight=Math.max(imageMin,photoTop+rows.slice(offset).reduce((sum,row)=>sum+row.height,0))+2*pad;
    const freshHeight=bottom-(pages.length===1?pageTop:100);
    reserve(fullHeight<=freshHeight?fullHeight:Math.max(imageMin,photoTop+rows[offset].height)+2*pad);
    const available=bottom-y-2*pad-photoTop;
    let end=offset,used=0;
    while(end<rows.length&&used+rows[end].height<=available){used+=rows[end].height;end++;}
    if(end===offset){if(grid){flushGridRow();addPage();}else nextColumn();continue;}
    const height=Math.max(imageMin,photoTop+used)+2*pad;
    const x=margin+col*(columnWidth+gap);
    if(grid){
     graphic({kind:'rect',x:x+3,y:y+4,width:columnWidth,height,fill:colors.muted,radius:18,opacity:.12});
     graphic({kind:'rect',x,y,width:columnWidth,height,fill:colors.panel,radius:18});
    }else if(board)extendCategoryPanel(y+height);
    else graphic({kind:'line',x,y:y+height,x2:x+columnWidth,y2:y+height,stroke:colors.accent,strokeWidth:1,opacity:.35});
    if(first){
     page.itemStarts.push(item.recipeId);
     if(hasPhoto)page.images!.push({recipeId:item.recipeId,x:x+pad+(grid&&design.photo_frame==='circle'?(photoWidth-photoHeight)/2:0),y:y+pad,width:grid&&design.photo_frame==='circle'?photoHeight:photoWidth,height:photoHeight,frame:design.photo_frame});
    }
    let cursor=y+pad+photoTop;
    for(let i=offset;i<end;i++){
     const row=rows[i];run(row.text,row.font,row.align==='right'?x+columnWidth-pad:x+pad+sideOffset,cursor+row.font.size,row.color,row.align??'left',item.recipeId,row.height,grid||board?colors.panel:colors.background);cursor+=row.height;
    }
    offset=end;first=false;finishBlock(height);
    if(offset<rows.length&&!grid)nextColumn();
   }
  }
  if(grid)flushGridRow();y+=board?8:18;
 }
 pages.forEach((entry,index)=>entry.runs.push({text:`${index+1} / ${pages.length}`,x:408,baseline:1012,size:12,lineHeight:18,family:bodyFamily,weight:400,color:ink(colors.muted,colors.background),align:'center'}));
 return {width:816,height:1056,pages};
}
