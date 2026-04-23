"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useT } from "../lib/i18n";
import { RecipeCard } from "../components/RecipeCard";
import { CATEGORY_LABELS, type LibraryFilterId } from "../lib/recipeCategories";
import { TagFilterPopover } from "../components/TagFilterPopover";
import type { Recipe } from "../types";

function ingredientPreview(recipe: Recipe, fallback: string, maxLength = 72): string {
  const parts = recipe.ingredients.slice(0, 4).map((i) => i.name).filter(Boolean);
  const text = parts.join(", ") || fallback;
  return text.length > maxLength ? text.slice(0, maxLength).trim() + "…" : text;
}

function LibraryPageContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [publicRecipes, setPublicRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilterId>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"mine" | "public">("mine");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const t = useT();

  const fetchRecipes = async () => {
    try {
      const [mineRes, publicRes] = await Promise.all([
        apiFetch("/recipes"),
        apiFetch("/recipes/catalog"),
      ]);
      if (!mineRes.ok) throw new Error("Failed to load recipes");
      const data = await mineRes.json();
      const publicData = publicRes.ok ? await publicRes.json() : [];
      setRecipes(data);
      setPublicRecipes(Array.isArray(publicData) ? publicData : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, []);

  const filteredMine = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...recipes]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .filter((r) => {
        const tags = r.library_tags ?? (r.library_category ? [r.library_category] : []);
        if (filter !== "all" && !tags.includes(filter)) return false;
        if (q && !r.title.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [recipes, filter, search]);

  const filteredPublic = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...publicRecipes]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .filter((r) => {
        const tags = r.library_tags ?? (r.library_category ? [r.library_category] : []);
        if (filter !== "all" && !tags.includes(filter)) return false;
        if (q && !r.title.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [publicRecipes, filter, search]);

  const savedPublicIds = useMemo(() => {
    const ids = new Set<string>();
    recipes.forEach((recipe) => {
      ids.add(recipe.id);
      if (recipe.catalog_source_recipe_id) ids.add(recipe.catalog_source_recipe_id);
    });
    return ids;
  }, [recipes]);

  async function handleCopyPublicRecipe(recipeId: string) {
    setCopyingId(recipeId);
    setError(null);
    try {
      const res = await apiFetch(`/recipes/catalog/${recipeId}/copy`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Could not add recipe");
      }
      const recipe: Recipe = await res.json();
      setRecipes((prev) => (prev.some((row) => row.id === recipe.id) ? prev : [...prev, recipe]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add recipe");
    } finally {
      setCopyingId(null);
    }
  }

  if (loading) return <p style={mutedStyle}>{t("common.loading")}</p>;
  if (error && recipes.length === 0 && publicRecipes.length === 0) return <p style={errorStyle}>{error}</p>;

  const activeList = view === "mine" ? filteredMine : filteredPublic;

  return (
    <>
      <h1 className="library-page-title font-headline">{t("library.title")}</h1>

      <div className="library-chip-row" role="tablist" aria-label={t("library.views")} style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className={`library-chip ${view === "mine" ? "library-chip--active" : "library-chip--idle"}`}
          onClick={() => setView("mine")}
        >
          {t("library.myLibrary")}
        </button>
        <button
          type="button"
          className={`library-chip ${view === "public" ? "library-chip--active" : "library-chip--idle"}`}
          onClick={() => setView("public")}
        >
          {t("library.publicLibrary")}
        </button>
      </div>

      <p style={{ ...mutedStyle, marginTop: 0, marginBottom: "1.25rem", maxWidth: "42rem", lineHeight: 1.5 }}>
        {view === "mine"
          ? t("library.myLibraryDesc")
          : t("library.publicLibraryDesc")}
      </p>

      {error ? <p style={{ ...errorStyle, marginTop: 0 }}>{error}</p> : null}

      <div className="library-search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3-3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          className="library-search-input"
          placeholder={t("library.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("library.searchAria")}
        />
      </div>

      <div className="library-filter-bar">
        <TagFilterPopover
          value={filter}
          onChange={setFilter}
          ariaLabel={t("library.filterAria")}
        />
        {filter !== "all" ? (
          <button
            type="button"
            className="library-filter-reset font-headline"
            onClick={() => setFilter("all")}
          >
            {t("library.clearFilter")}
          </button>
        ) : null}
      </div>

      {activeList.length === 0 ? (
        <div style={emptyStyle}>
          <p style={{ margin: 0, fontWeight: 700, color: "var(--on-surface)", fontSize: "1.05rem" }}>
            {view === "mine"
              ? (recipes.length === 0 ? t("library.yourShelfReady") : t("common.noMatches"))
              : publicRecipes.length === 0
                ? t("library.publicShelfEmpty")
                : t("common.noMatches")}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", lineHeight: 1.5 }}>
            {view === "mine"
              ? recipes.length === 0
                ? t("library.importRecipePrompt")
                : t("library.tryAnotherFilter")
              : publicRecipes.length === 0
                ? t("library.publicShelfEmptyDesc")
                : t("library.tryAnotherFilter")}
          </p>
          {view === "mine" && recipes.length === 0 && (
            <Link href="/import" style={linkStyle}>
              {t("library.importRecipe")} →
            </Link>
          )}
        </div>
      ) : view === "mine" ? (
        <ul className="libraryGrid">
          {filteredMine.map((r) => (
            <RecipeCard key={r.id} recipe={r} isHighlighted={highlightId === r.id} />
          ))}
        </ul>
      ) : (
        <ul className="libraryGrid">
          {filteredPublic.map((recipe) => {
            const alreadyAdded = savedPublicIds.has(recipe.id);
            const preview = ingredientPreview(recipe, t("library.readyToAdd"));
            return (
              <li key={recipe.id} className="recipe-card-stitch">
                <div className="recipe-card-stitch__media">
                  {recipe.thumbnail_url ? (
                    <>
                      <img src={recipe.thumbnail_url} alt="" className="recipe-card-stitch__img recipe-card-stitch__img--bg" />
                      <div className="recipe-card-stitch__img-frame">
                        <img src={recipe.thumbnail_url} alt="" className="recipe-card-stitch__img recipe-card-stitch__img--full" />
                      </div>
                    </>
                  ) : (
                    <div className="recipe-card-stitch__placeholder recipeCardPlaceholder">
                      <span className="font-headline recipe-card-stitch__placeholder-text">Recipe</span>
                    </div>
                  )}
                </div>
                <div className="recipe-card-stitch__meta" style={{ paddingTop: 0 }}>
                  <div className="recipe-card-stitch__meta-left" style={{ width: "100%" }}>
                    <h2 className="font-headline recipe-card-stitch__title">{recipe.title}</h2>
                    <p className="recipe-card-stitch__sub" title={preview}>
                      {preview}
                    </p>
                    {(recipe.library_tags?.length || recipe.library_category) ? (
                      <div className="recipe-card-stitch__tag-row">
                        {(recipe.library_tags ?? (recipe.library_category ? [recipe.library_category] : []))
                          .slice(0, 3)
                          .map((tag) => (
                            <span key={tag} className="recipe-card-stitch__tag-mini font-headline">
                              {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
                            </span>
                          ))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ marginTop: "0.9rem", width: "100%", justifyContent: "center" }}
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
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link href="/import" className="library-fab" aria-label={t("library.importRecipe")}>
        <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>+</span>
        <span className="library-fab__text">{t("library.importRecipe")}</span>
      </Link>
    </>
  );
}

export default function LibraryPage() {
  return (
    <RequireAuth>
      <div className="app-container app-container--fab" style={{ position: "relative" }}>
        <Suspense fallback={<p style={mutedStyle}>Loading...</p>}>
          <LibraryPageContent />
        </Suspense>
      </div>
    </RequireAuth>
  );
}

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
};

const emptyStyle: React.CSSProperties = {
  padding: "var(--space-40) var(--space-32)",
  background: "var(--surface-container-low)",
  borderRadius: "var(--radius-card)",
  textAlign: "center",
  color: "var(--on-surface-variant)",
  boxShadow: "var(--kitchen-glow)",
};

const linkStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: "1rem",
  color: "var(--primary)",
  fontWeight: 700,
};

const errorStyle: React.CSSProperties = {
  color: "#c62828",
};
