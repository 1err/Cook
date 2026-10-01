"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { IngredientOption } from "@cooking/shared";
import { useI18n, useT } from "../lib/i18n";
import styles from "./LibraryPage.module.css";

export function ingredientLabel(name: string, options: IngredientOption[], language: "en" | "zh") {
  return options.find(item=>item.id===name)?.[language] ?? name;
}
export function IngredientSearch({options,selected,onAdd}:{options:IngredientOption[];selected:string[];onAdd:(name:string)=>void}) {
  const t=useT();const {language}=useI18n();const id=useId();const ref=useRef<HTMLInputElement>(null);
  const [query,setQuery]=useState("");const [open,setOpen]=useState(false);const [active,setActive]=useState(-1);
  const normalized=query.normalize("NFKC").trim().toLowerCase()
    .replace(/\s*[(（](sliced|chopped|minced|diced|grated|peeled|optional|to taste|切片|切丝|切块|切丁|剁碎|拍碎|去皮|去骨)[)）]\s*/g," ")
    .replace(/^(fresh|chopped|minced|diced|sliced|grated|peeled|boneless|skinless) +/,"")
    .replace(/^(fresh|chopped|minced|diced|sliced|grated|peeled|boneless|skinless) +/,"")
    .replace(/^(fresh|chopped|minced|diced|sliced|grated|peeled|boneless|skinless) +/,"")
    .replace(/\s+/g," ").trim();
  const exact=options.find(item=>item.id===normalized || item.aliases.includes(normalized));
  const suggestions=normalized ? options.filter(item=>!selected.includes(item.id) && [item.en,item.zh,...item.aliases].some(name=>name.toLowerCase().includes(normalized))).slice(0,7):[];
  const custom=normalized && !exact && !selected.includes(normalized) ? normalized:null;
  const choices=[...suggestions.map(item=>item.id),...(custom?[custom]:[])];
  const visible=open && normalized && choices.length>0;
  useEffect(()=>{if(visible && active>=0)document.getElementById(`${id}-${active}`)?.scrollIntoView?.({block:"nearest"});},[visible,active,id]);
  function add(name:string) {
    if(selected.length>=20 || selected.includes(name))return;
    onAdd(name);setQuery("");setOpen(false);setActive(-1);ref.current?.focus();
  }
  return <div className={styles.ingredientInput}>
    <input ref={ref} role="combobox" aria-label={t("library.ingredients.input")} aria-expanded={Boolean(visible)} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={visible && active>=0?`${id}-${active}`:undefined}
      value={query} maxLength={100} autoComplete="off" placeholder={t("library.ingredients.placeholder")}
      onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}
      onChange={event=>{setQuery(event.target.value);setOpen(true);setActive(-1);}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(event.key==="Escape"){setOpen(false);setActive(-1);}
        if(event.key==="ArrowDown" && choices.length){event.preventDefault();setOpen(true);setActive(value=>(value+1)%choices.length);}
        if(event.key==="ArrowUp" && choices.length){event.preventDefault();setOpen(true);setActive(value=>(value-1+choices.length)%choices.length);}
        if(event.key==="Enter" && normalized){event.preventDefault();const name=active>=0 && choices[active]?choices[active]:exact?.id??normalized;add(name);}
      }} />
    {visible ? <ul id={`${id}-options`} role="listbox" aria-label={t("library.ingredients.suggestions")} className={styles.suggestions}>
      {choices.map((name,index)=><li role="option" id={`${id}-${index}`} aria-selected={active===index} key={name} onPointerDown={event=>event.preventDefault()} onClick={()=>add(name)} onPointerMove={()=>setActive(index)}>
        <span>{name===custom?t("library.ingredients.searchFor",{name:query.trim()}):ingredientLabel(name,options,language)}</span><span aria-hidden="true">+</span>
      </li>)}
    </ul>:null}
  </div>;
}
