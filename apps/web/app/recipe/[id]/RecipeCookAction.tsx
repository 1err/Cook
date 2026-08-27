"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CookingSession, Recipe } from "@cooking/shared";
import { webApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import styles from "./RecipeDetail.module.css";

export function RecipeCookAction({ recipe }: { recipe: Recipe }) {
  const t = useT();
  const router = useRouter();
  const [session, setSession] = useState<CookingSession | null>(null);
  const [loading, setLoading] = useState(Boolean(recipe.steps?.length));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recipe.steps?.length) return;
    let cancelled = false;
    webApiClient.cooking.active()
      .then((active) => {
        if (!cancelled) setSession(active);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("cook.recipe.error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recipe.steps?.length, t]);

  if (!recipe.steps?.length) {
    return (
      <Link className={styles.primaryAction} href={`/recipe/${encodeURIComponent(recipe.id)}/tutorial/edit`}>
        {t("cook.recipe.editTutorial")}
      </Link>
    );
  }

  const existingDish = session?.dishes.find((dish) => dish.recipe_id === recipe.id);
  if (existingDish) {
    return (
      <Link className={styles.primaryAction} href={`/cook?dish=${encodeURIComponent(existingDish.id)}`}>
        {t("cook.recipe.open")}
      </Link>
    );
  }

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      if (session) {
        await webApiClient.cooking.addDishes(session.id, [recipe.id]);
      } else {
        await webApiClient.cooking.create([recipe.id]);
      }
      router.push("/cook");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("cook.recipe.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={styles.cookAction}>
      <button className={styles.primaryAction} disabled={loading || busy} onClick={() => void begin()} type="button">
        {loading ? t("common.loading") : session ? t("cook.recipe.add") : t("cook.recipe.start")}
      </button>
      {error ? <span className={styles.actionError} role="alert">{error}</span> : null}
    </span>
  );
}
