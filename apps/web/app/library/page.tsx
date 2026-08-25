"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useT } from "../lib/i18n";
import { RecipeCard } from "../components/RecipeCard";
import { PageHeader, PageShell } from "../components/PageShell";
import { CATEGORY_LABELS, type LibraryFilterId, type RecipeTagSlug } from "../lib/recipeCategories";
import { getRecipeTags } from "../lib/recipeTags";
import { TagFilterPopover } from "../components/TagFilterPopover";
import type { Recipe } from "../types";
import styles from "./LibraryPage.module.css";

function LibraryPageContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [publicRecipes, setPublicRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mineFilters, setMineFilters] = useState<RecipeTagSlug[]>([]);
  const [publicFilter, setPublicFilter] = useState<LibraryFilterId>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"mine" | "public">("mine");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    let active = true;
    async function fetchRecipes() {
      try {
        const [mineRes, publicRes] = await Promise.all([
          apiFetch("/recipes"),
          apiFetch("/recipes/catalog"),
        ]);
        if (!mineRes.ok) throw new Error("Failed to load recipes");
        const data = await mineRes.json();
        const publicData = publicRes.ok ? await publicRes.json() : [];
        if (!active) return;
        setRecipes(data);
        setPublicRecipes(Array.isArray(publicData) ? publicData : []);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchRecipes();
    return () => {
      active = false;
    };
  }, []);

  const filteredMine = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...recipes]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .filter((recipe) => {
        const tags = getRecipeTags(recipe);
        return !(
          (mineFilters.length > 0 && !mineFilters.every((tag) => tags.includes(tag))) ||
          (query && !recipe.title.toLowerCase().includes(query))
        );
      });
  }, [mineFilters, recipes, search]);

  const filteredPublic = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...publicRecipes]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .filter((recipe) => {
        const tags = getRecipeTags(recipe);
        return !(
          (publicFilter !== "all" && !tags.includes(publicFilter)) ||
          (query && !recipe.title.toLowerCase().includes(query))
        );
      });
  }, [publicFilter, publicRecipes, search]);

  const mineFilterLabel = useMemo(() => {
    if (mineFilters.length === 0) return "All tags";
    if (mineFilters.length === 1) return CATEGORY_LABELS[mineFilters[0]];
    return `${mineFilters.length} tags`;
  }, [mineFilters]);

  const savedPublicIds = useMemo(() => {
    const ids = new Set<string>();
    recipes.forEach((recipe) => {
      ids.add(recipe.id);
      if (recipe.catalog_source_recipe_id) ids.add(recipe.catalog_source_recipe_id);
    });
    return ids;
  }, [recipes]);

  function toggleMineFilter(tag: RecipeTagSlug) {
    setMineFilters((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  async function handleCopyPublicRecipe(recipeId: string) {
    setCopyingId(recipeId);
    setError(null);
    try {
      const response = await apiFetch(`/recipes/catalog/${recipeId}/copy`, { method: "POST" });
      if (!response.ok) throw new Error((await response.text()) || "Could not add recipe");
      const recipe: Recipe = await response.json();
      setRecipes((current) =>
        current.some((row) => row.id === recipe.id) ? current : [...current, recipe],
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add recipe");
    } finally {
      setCopyingId(null);
    }
  }

  const activeList = view === "mine" ? filteredMine : filteredPublic;

  return (
    <>
      <PageHeader title={t("library.title")} />

      <div className={styles.tabs} role="tablist" aria-label={t("library.views")}>
        <button
          type="button"
          role="tab"
          aria-selected={view === "mine"}
          className={styles.tab}
          onClick={() => setView("mine")}
        >
          {t("library.myLibrary")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "public"}
          className={styles.tab}
          onClick={() => setView("public")}
        >
          {t("library.publicLibrary")}
        </button>
        <Link href="/library/friends" role="tab" aria-selected={false} className={styles.tab}>
          Friends
        </Link>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" strokeLinecap="round" />
          </svg>
          <span className={styles.visuallyHidden}>{t("library.searchAria")}</span>
          <input
            type="search"
            placeholder={t("library.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        {view === "mine" ? (
          <TagFilterPopover
            values={mineFilters}
            onToggleValue={toggleMineFilter}
            onClear={() => setMineFilters([])}
            ariaLabel={t("library.filterAria")}
            triggerLabel={mineFilterLabel}
          />
        ) : (
          <TagFilterPopover
            value={publicFilter}
            onChange={setPublicFilter}
            ariaLabel={t("library.filterAria")}
          />
        )}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {loading ? (
        <p className={styles.status}>{t("common.loading")}</p>
      ) : activeList.length === 0 ? (
        <div className={styles.empty}>
          <p>
            {view === "mine"
              ? recipes.length === 0
                ? t("library.yourShelfReady")
                : t("common.noMatches")
              : publicRecipes.length === 0
                ? t("library.publicShelfEmpty")
                : t("common.noMatches")}
          </p>
          {view === "mine" && recipes.length === 0 ? (
            <Link href="/import">{t("library.importRecipe")} →</Link>
          ) : null}
        </div>
      ) : view === "mine" ? (
        <ul className={styles.grid}>
          {filteredMine.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} isHighlighted={highlightId === recipe.id} />
          ))}
        </ul>
      ) : (
        <ul className={styles.grid}>
          {filteredPublic.map((recipe) => {
            const alreadyAdded = savedPublicIds.has(recipe.id);
            const tags = getRecipeTags(recipe).slice(0, 2);
            return (
              <li key={recipe.id} className={styles.publicCard}>
                <div className={styles.publicMedia}>
                  {recipe.thumbnail_url ? (
                    <img src={recipe.thumbnail_url} alt="" />
                  ) : (
                    <span className="cw-display" aria-hidden>CW</span>
                  )}
                </div>
                <div className={styles.publicBody}>
                  <h2 className="cw-display">{recipe.title}</h2>
                  {recipe.total_time_minutes ? <p>{recipe.total_time_minutes} min</p> : null}
                  {tags.length ? (
                    <div className={styles.publicTags}>
                      {tags.map((tag) => (
                        <span key={tag}>{CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={styles.addButton}
                    onClick={() => handleCopyPublicRecipe(recipe.id)}
                    disabled={alreadyAdded || copyingId === recipe.id}
                  >
                    {alreadyAdded
                      ? t("library.inYourLibrary")
                      : copyingId === recipe.id
                        ? t("library.adding")
                        : t("library.addToMyLibrary")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function LibraryPage() {
  return (
    <RequireAuth>
      <PageShell>
        <Suspense fallback={<p className={styles.status}>Loading...</p>}>
          <LibraryPageContent />
        </Suspense>
      </PageShell>
    </RequireAuth>
  );
}
