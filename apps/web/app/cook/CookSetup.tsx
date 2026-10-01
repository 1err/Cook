"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, resolveRecipeDetails } from "@cooking/api-client";
import type { CookingSession, MealPlanDay, MealType, Recipe } from "@cooking/shared";
import { PageHeader } from "../components/PageShell";
import { Button, ActionLink } from "../components/ui/Button";
import { webApiClient } from "../lib/api";
import { useT } from "../lib/i18n";
import { useRecipePage } from "../lib/useRecipePage";
import styles from "./CookPage.module.css";
import { CookDatePicker } from "./CookDatePicker";
import { getPlannedSelection } from "./cookSetupModel";

type CookSetupProps = {
  onSessionCreated: (session: CookingSession) => void;
};

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const page = useRecipePage("mine", {q: search});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPlans([]);
    setRecipes([]);
    webApiClient.mealPlan.list(date, date)
      .then(async nextPlans => {
        const nextRecipes = await resolveRecipeDetails(webApiClient.recipes.get, nextPlans.flatMap(plan => [...plan.breakfast, ...plan.lunch, ...plan.dinner]));
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
  const filteredRecipes = page.items;

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

  return (
    <section className={styles.setup}>
      <PageHeader title={t("cook.empty.title")} description={t("cook.empty.description")} />

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
        <div className={styles.plannedSetup}>
          <CookDatePicker value={date} today={todayIso()} onChange={setDate} />
          <div className={styles.plannedMealPanel}>
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
          {loading ? <p role="status">{t("common.loading")}</p> : plannedSelection.length ? (
            <ul className={styles.selectionList}>
              {plannedSelection.map((recipeId) => {
                const recipe = recipes.find((item) => item.id === recipeId);
                return (
                  <li key={recipeId} className={styles.plannedRecipe}>
                    <span className={styles.recipeThumb}>
                      {recipe?.thumbnail_url ? <img alt="" src={recipe.thumbnail_url} /> : null}
                    </span>
                    <strong>{recipe?.title ?? recipeId}</strong>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.plannedEmpty}>
              <p>{t("cook.setup.noPlannedRecipes")}</p>
              <ActionLink href={`/planner?week=${date}`} variant="ghost">{t("cook.setup.openPlanner")}</ActionLink>
              <Button onClick={() => setMode("manual")} variant="secondary">
                {t("cook.setup.chooseInstead")}
              </Button>
            </div>
          )}
          <div className={styles.setupAction}>
            <Button disabled={loading || selected.length === 0 || Boolean(error)} loading={submitting} onClick={() => void start()}>
              {selected.length === 1 ? t("cook.setup.startOne") : selected.length ? t("cook.setup.startCount", { count: selected.length }) : t("cook.setup.selectToStart")}
            </Button>
          </div>
          </div>
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
          {page.loading ? <p role="status">{t("common.loading")}</p> : !page.error && filteredRecipes.length === 0 ? (
            <div className={styles.emptyChoices}>
              <p>{t(search.trim() ? "common.noMatches" : "cook.setup.emptyLibrary")}</p>
              {!search.trim() ? <ActionLink href="/library?view=public" variant="secondary">{t("library.browsePublic")}</ActionLink> : null}
            </div>
          ) : null}
          <div className={styles.recipeChoices} role="group" aria-label={t("cook.setup.chooseRecipes")}>
            {filteredRecipes.map((recipe) =>
              recipe.step_count ? (
                <label key={recipe.id} className={styles.recipeChoice}>
                  <span className={styles.recipeThumb}>
                    {recipe.thumbnail_url ? <img alt="" src={recipe.thumbnail_url} /> : null}
                  </span>
                  <span className={styles.recipeChoiceTitle}>{recipe.title}</span>
                  <input
                    type="checkbox"
                    checked={manualSelection.includes(recipe.id)}
                    onChange={() => toggleRecipe(recipe.id)}
                  />
                </label>
              ) : (
                <div key={recipe.id} className={styles.recipeChoice}>
                  <span className={styles.recipeThumb}>
                    {recipe.thumbnail_url ? <img alt="" src={recipe.thumbnail_url} /> : null}
                  </span>
                  <span className={styles.recipeChoiceTitle}>{recipe.title}</span>
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

      {page.next && mode === "manual" ? <Button disabled={page.loading} onClick={() => void page.more()}>{t("common.loadMoreRecipes")}</Button> : null}
      {page.error ? <p role="alert">{page.error}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {mode === "manual" ? <div className={styles.setupAction}>
        <Button disabled={selected.length === 0} loading={submitting} onClick={() => void start()}>
          {selected.length === 1 ? t("cook.setup.startOne") : selected.length ? t("cook.setup.startCount", { count: selected.length }) : t("cook.setup.selectToStart")}
        </Button>
      </div> : null}

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
