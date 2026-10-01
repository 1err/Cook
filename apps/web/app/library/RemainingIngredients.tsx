"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IngredientOption } from "@cooking/shared";
import { useI18n, useT } from "../lib/i18n";
import { ingredientLabel } from "./IngredientSearch";
import styles from "./LibraryPage.module.css";

export function RemainingIngredients({names,options,title}:{names:string[];options:IngredientOption[];title:string}) {
  const t=useT();const {language}=useI18n();const id=useId();const button=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);
  const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [open,setOpen]=useState(false);const [pinned,setPinned]=useState(false);const pinnedRef=useRef(false);
  const [position,setPosition]=useState({left:12,top:0,width:260,maxHeight:250});
  function show(){if(closeTimer.current)clearTimeout(closeTimer.current);setOpen(true);}
  function leave(){if(closeTimer.current)clearTimeout(closeTimer.current);closeTimer.current=setTimeout(()=>{if(!pinnedRef.current && document.activeElement!==button.current)setOpen(false);},180);}
  useEffect(()=>()=>{if(closeTimer.current)clearTimeout(closeTimer.current);},[]);
  function dismiss(){if(closeTimer.current)clearTimeout(closeTimer.current);pinnedRef.current=false;setPinned(false);setOpen(false);}
  useLayoutEffect(()=>{
    if(!open || !button.current)return;
    const rect=button.current.getBoundingClientRect();const width=Math.min(280,window.innerWidth-24);const bottom=window.innerHeight-(window.innerWidth<=640?88:12);const height=Math.min(260,bottom-24);
    const estimated=Math.min(height,85+names.length*29);const top=rect.bottom+8+estimated<=bottom?rect.bottom+8:Math.max(12,rect.top-estimated-8);
    setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top,width,maxHeight:height});
  },[open,names.length]);
  useEffect(()=>{
    if(!open)return;
    function outside(event:PointerEvent){if(!button.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node))dismiss();}
    function scroll(event:Event){if(!panel.current?.contains(event.target as Node))dismiss();}
    function escape(event:KeyboardEvent){if(event.key==="Escape")dismiss();}
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);window.addEventListener("resize",dismiss);window.addEventListener("scroll",scroll,true);
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);window.removeEventListener("resize",dismiss);window.removeEventListener("scroll",scroll,true);};
  },[open]);
  if(!names.length)return <p className={styles.noRemaining}>{t("library.ingredients.noMore")}</p>;
  return <>
    <button type="button" ref={button} className={styles.remainingButton} aria-expanded={open} aria-controls={open?id:undefined} aria-describedby={open?id:undefined}
      onPointerEnter={event=>{if(event.pointerType==="mouse")show();}} onPointerLeave={event=>{
        if(!pinnedRef.current && !panel.current?.contains(event.relatedTarget as Node) && document.activeElement!==button.current)leave();
      }} onFocus={()=>setOpen(true)} onBlur={()=>{if(!pinnedRef.current)setOpen(false);}} onClick={()=>{const next=!pinned;pinnedRef.current=next;setPinned(next);setOpen(next);}}>
      {t("library.ingredients.more",{count:names.length})}
    </button>
    {open?createPortal(<div ref={panel} id={id} role="tooltip" aria-label={t("library.ingredients.otherFor",{title})} className={styles.ingredientPopover} style={position}
      onPointerEnter={show} onPointerLeave={leave}>
      <strong>{t("library.ingredients.other")}</strong><ul>{names.map(name=><li key={name}>{ingredientLabel(name,options,language)}</li>)}</ul>
      <p>{t("library.ingredients.quantities")}</p>
    </div>,document.body):null}
  </>;
}
