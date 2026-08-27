"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@cooking/api-client";
import type { CookingSession, MealPlanDay, MealType, Recipe } from "@cooking/shared";
import { Button } from "../components/ui/Button";
import { webApiClient } from "../lib/api";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { getPlannedSelection } from "./cookSetupModel";

type CookSetupProps = {
  onSessionCreated: (session: CookingSession) => void;
};

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CookSetup({ onSessionCreated }: CookSetupProps) {
  const t = useT();
  const [mode, setMode] = useState<"planned" | "manual">("planned");
  const [date, setDate] = useState(todayIso);
  const [meal, setMeal] = useState<MealType>("dinner");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [plans, setPlans] = useState<MealPlanDay[]>([]);
  const [manualSelection, setManualSelection] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([webApiClient.recipes.list(), webApiClient.mealPlan.list(date, date)])
      .then(([nextRecipes, nextPlans]) => {
        if (cancelled) return;
        setRecipes(nextRecipes);
        setPlans(nextPlans);
        setError(null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t("cook.error.title"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, t]);

  const plannedSelection = useMemo(
    () => getPlannedSelection(plans, date, meal),
    [date, meal, plans],
  );
  const selected = mode === "planned" ? plannedSelection : manualSelection;
  const query = search.trim().toLocaleLowerCase();
  const filteredRecipes = recipes.filter((recipe) =>
    query ? recipe.title.toLocaleLowerCase().includes(query) : true,
  );

  function toggleRecipe(recipeId: string) {
    setManualSelection((current) =>
      current.includes(recipeId)
        ? current.filter((item) => item !== recipeId)
        : [...current, recipeId],
    );
  }

  async function start(recipeIds = selected) {
    if (recipeIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      onSessionCreated(await webApiClient.cooking.create(recipeIds));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "active_session_exists") {
        setConflict(true);
      } else {
        setError(caught instanceof Error ? caught.message : t("cook.error.title"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function resume() {
    const active = await webApiClient.cooking.active();
    if (active) onSessionCreated(active);
  }

  async function discardAndStart() {
    const active = await webApiClient.cooking.active();
    if (active) await webApiClient.cooking.discard(active.id);
    setConflict(false);
    await start();
  }

  if (loading) return <p role="status">{t("common.loading")}</p>;

  return (
    <section className={styles.setup}>
      <header className={styles.setupHeader}>
        <p className={styles.eyebrow}>{t("nav.cook")}</p>
        <h1>{t("cook.empty.title")}</h1>
        <p>{t("cook.empty.description")}</p>
      </header>

      <div className={styles.modeTabs} role="tablist" aria-label={t("cook.empty.title")}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "planned"}
          onClick={() => setMode("planned")}
        >
          {t("cook.setup.plannedMeal")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          onClick={() => setMode("manual")}
        >
          {t("cook.setup.chooseRecipes")}
        </button>
      </div>

      {mode === "planned" ? (
        <div className={styles.setupPanel}>
          <label className={styles.dateField}>
            <span>{t("cook.setup.plannedMeal")}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <div className={styles.mealTabs}>
            {MEALS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={meal === value}
                onClick={() => setMeal(value)}
              >
                {t(`cook.setup.${value}`)}
              </button>
            ))}
          </div>
          {plannedSelection.length ? (
            <ul className={styles.selectionList}>
              {plannedSelection.map((recipeId) => (
                <li key={recipeId}>{recipes.find((recipe) => recipe.id === recipeId)?.title ?? recipeId}</li>
              ))}
            </ul>
          ) : (
            <div>
              <p>{t("cook.setup.noPlannedRecipes")}</p>
              <Button onClick={() => setMode("manual")} variant="secondary">
                {t("cook.setup.chooseInstead")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.setupPanel}>
          <label className={styles.searchField}>
            <span>{t("common.search")}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className={styles.recipeChoices} role="group" aria-label={t("cook.setup.chooseRecipes")}>
            {filteredRecipes.map((recipe) =>
              recipe.steps?.length ? (
                <label key={recipe.id} className={styles.recipeChoice}>
                  <input
                    type="checkbox"
                    checked={manualSelection.includes(recipe.id)}
                    onChange={() => toggleRecipe(recipe.id)}
                  />
                  <span>{recipe.title}</span>
                </label>
              ) : (
                <div key={recipe.id} className={styles.recipeChoice}>
                  <span>{recipe.title}</span>
                  <Link
                    aria-label={`${t("cook.setup.editTutorial")} ${recipe.title}`}
                    href={`/recipe/${encodeURIComponent(recipe.id)}/tutorial/edit`}
                  >
                    {t("cook.setup.editTutorial")}
                  </Link>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <Button disabled={selected.length === 0} loading={submitting} onClick={() => void start()}>
        {t("cook.setup.startCount", { count: selected.length })}
      </Button>

      {conflict ? (
        <div className={styles.dialogBackdrop}>
          <section role="dialog" aria-modal="true" aria-label={t("cook.conflict.title")} className={styles.dialog}>
            <h2>{t("cook.conflict.title")}</h2>
            <p>{t("cook.conflict.message")}</p>
            <div className={styles.dialogActions}>
              <Button variant="secondary" onClick={() => void discardAndStart()}>
                {t("cook.conflict.discard")}
              </Button>
              <Button onClick={() => void resume()}>{t("cook.conflict.resume")}</Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
