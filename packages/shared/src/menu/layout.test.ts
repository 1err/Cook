import { describe, expect, it } from 'vitest';
import { layoutMenu } from './layout';
import type { MenuDraft } from './types';
export const draft: MenuDraft = {title:'Dinner 晚餐',subtitle:'Together',styleId:'cozy-cafe',instructions:'',artwork:null,sections:[{id:'b',title:'Second'},{id:'a',title:'First'}],items:[{recipeId:'1',sectionId:'a',name:'Soup',description:''},{recipeId:'2',sectionId:'b',name:'菜肴👩🏽‍🍳'.repeat(80),description:'Chinese 描述 👨‍👩‍👧‍👦 '.repeat(500)}]};
const measure = (text: string) => Array.from(new (Intl as typeof Intl & {Segmenter:new (locale:undefined,options:{granularity:string})=>{segment(text:string):Iterable<{segment:string}>}}).Segmenter(undefined,{granularity:'grapheme'}).segment(text)).length * 12;
describe('measured menu layout',()=>{
 it('keeps ordinary dish names and descriptions together across page boundaries',()=>{
  const items=Array.from({length:42},(_,index)=>({recipeId:String(index),sectionId:'a',name:`Dish ${index}`,description:`Description ${index}`}));
  const result=layoutMenu({...draft,sections:[{id:'a',title:'Dishes'}],items},measure);
  expect(result.pages.length).toBeGreaterThan(2);
  for(const item of items){
   const containing=result.pages.filter(page=>page.runs.some(run=>run.itemId===item.recipeId));
   expect(containing).toHaveLength(1);
   expect(containing[0].runs.filter(run=>run.itemId===item.recipeId).map(run=>run.text)).toEqual([item.name,item.description]);
  }
 });
 it('moves a section heading with its first ordinary dish',()=>{
  const items=Array.from({length:9},(_,index)=>({recipeId:String(index),sectionId:'a',name:`Dish ${index}`,description:`Description ${index}`}));
  items.push({recipeId:'dessert',sectionId:'b',name:'Dessert',description:'A sweet finish'});
  const result=layoutMenu({...draft,sections:[{id:'a',title:'Dishes'},{id:'b',title:'Desserts'}],items},measure);
  const headingPage=result.pages.findIndex(page=>page.runs.some(run=>run.text==='Desserts'));
  const dessertPage=result.pages.findIndex(page=>page.itemStarts.includes('dessert'));
  expect(headingPage).toBeGreaterThan(0);
  expect(dessertPage).toBe(headingPage);
  expect(result.pages[dessertPage].runs.filter(run=>run.itemId==='dessert').map(run=>run.text)).toEqual(['Dessert','A sweet finish']);
 });
 it('preserves complete ordered selection and continuation text without duplicate starts',()=>{
  const result=layoutMenu(draft,measure);
  expect(result.pages.length).toBeGreaterThan(2);
  expect(result.pages.flatMap(p=>p.itemStarts)).toEqual(['2','1']);
  const runs=result.pages.flatMap(p=>p.runs);
  expect(runs.filter(r=>r.itemId==='2').map(r=>r.text).join('')).toBe(draft.items[1].name+draft.items[1].description);
  for(const page of result.pages) for(const run of page.runs){expect(measure(run.text)).toBeLessThanOrEqual(672);expect(run.baseline).toBeLessThanOrEqual(1000);expect(run.size).toBeGreaterThanOrEqual(16);}
 });
 it('handles long unbroken text and newline-heavy titles and sections',()=>{
  const changed={...draft,title:'TITLE'.repeat(700)+'\n\nEnd',subtitle:'sub\n'.repeat(80),sections:[{id:'a',title:'Header\n'.repeat(80)}],items:[{recipeId:'1',sectionId:'a',name:'x'.repeat(2500),description:'\n\nend'}]};
  const result=layoutMenu(changed,measure);
  expect(result.pages.flatMap(p=>p.itemStarts)).toEqual(['1']);
  expect(result.pages.flatMap(p=>p.runs).filter(r=>r.itemId==='1').map(r=>r.text).join('')).toBe('x'.repeat(2500)+'end');
  expect(result.pages.length).toBeGreaterThan(5);
 });
 it('keeps emoji graphemes intact and text lines within margins',()=>{
  const result=layoutMenu({...draft,items:[{recipeId:'1',sectionId:'a',name:'👩🏽‍🍳'.repeat(1000),description:''}]},measure);
  for(const run of result.pages.flatMap(p=>p.runs).filter(r=>r.itemId==='1')) expect(run.text.split('👩🏽‍🍳').join('')).toBe('');
 });
});
