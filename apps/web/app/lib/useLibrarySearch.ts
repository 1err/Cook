"use client";
import { useEffect, useMemo, useState } from "react";
import { RecipePager, type LibrarySearchOptions } from "@cooking/api-client";
import type { LibraryRecipeSummary } from "@cooking/shared";
import { webApiClient } from "./api";

export function useLibrarySearch(scope: "all" | "mine" | "catalog", options: LibrarySearchOptions, enabled: boolean) {
  const key=JSON.stringify(options);
  const pager=useMemo(()=>{
    const filters: LibrarySearchOptions=JSON.parse(key);
    return new RecipePager<LibraryRecipeSummary>(cursor=>webApiClient.recipes.searchPage({...filters,scope,cursor}));
  },[scope,key]);
  const [,paint]=useState(0);
  useEffect(()=>{
    const unsubscribe=pager.subscribe(()=>paint(value=>value+1));
    if(enabled)void pager.refresh();
    return()=>{unsubscribe();pager.dispose();};
  },[pager,enabled]);
  return {...pager.state,more:pager.more,refresh:pager.refresh};
}
