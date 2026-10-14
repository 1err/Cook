"use client";
import { useEffect, useMemo, useState } from "react";
import { RecipePager, type RecipePageOptions } from "@cooking/api-client";
import { useAuth } from "./auth";
import { webApiClient } from "./api";

export function useRecipePage(scope: "mine" | "catalog" | string = "mine", options: RecipePageOptions = {}, enabled = true) {
  const api = webApiClient;
  const { user } = useAuth();
  const accountId = user?.id;
  const key = JSON.stringify(options);
  const pager = useMemo(() => {
    const filters: RecipePageOptions = { ...JSON.parse(key), expectedAccountId: accountId };
    return new RecipePager(cursor => scope === "mine" ? api.recipes.page({...filters, cursor})
      : scope === "catalog" ? api.recipes.catalogPage({...filters, cursor})
      : api.users.libraryPage(scope, {...filters, cursor}));
  }, [api, scope, key, accountId]);
  const [, paint] = useState(0);
  useEffect(() => {
    const unsubscribe = pager.subscribe(() => paint(value => value + 1));
    if (enabled) void pager.refresh();
    return () => { unsubscribe(); pager.dispose(); };
  }, [pager, enabled]);
  return { ...pager.state, more: pager.more, refresh: pager.refresh };
}
