"use client";

import { useEffect, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { apiFetch } from "./api";
import { useAccountScope } from "./useAccountScope";

export function useRecipeAuthors(query: string, enabled = true) {
  const scope = useAccountScope();
  const [authors, setAuthors] = useState<RecipeAuthor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setAuthors([]);
    setError(false);
    const actor = scope.capture();
    if (!enabled || !actor) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch(`/recipes/authors?${new URLSearchParams({ q: query.trim(), limit: "40" })}`, {
          signal: controller.signal, headers: { "X-Chef-World-Account-ID": actor.id },
        });
        if (!response.ok) throw new Error("Author lookup failed");
        const rows: RecipeAuthor[] = await response.json();
        if (!Array.isArray(rows)) throw new Error("Invalid authors");
        if (!controller.signal.aborted && scope.active(actor)) setAuthors(rows);
      } catch {
        if (!controller.signal.aborted && scope.active(actor)) setError(true);
      } finally {
        if (!controller.signal.aborted && scope.active(actor)) setLoading(false);
      }
    }, query.trim() ? 180 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, enabled, attempt, scope.accountId]);
  return { authors, loading, error, retry: () => setAttempt(value => value + 1) };
}
