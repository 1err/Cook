"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AuthorPicker } from "../../components/AuthorPicker";
import { PageShell } from "../../components/PageShell";
import { RecipeCoverEditor } from "../../components/RecipeCoverEditor";
import { RecipeImageGenerator } from "../../components/RecipeImageGenerator";
import { RequireAuth } from "../../components/RequireAuth";
import { Icon } from "../../components/ui/Icon";
import { StepListEditor } from "../../import/StepListEditor";
import { apiFetch } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { RECIPE_TAG_GROUPS, type RecipeTagSlug } from "../../lib/recipeCategories";
import { getRecipeTags } from "../../lib/recipeTags";
import { stepTotalMinutes } from "../../lib/recipeTotalTime";
import { uploadRecipeImage } from "../../lib/uploadRecipeImage";
import type { IngredientItem, Recipe } from "../../types";
import { EditorSections, useEditorSection } from "./EditorSections";
import { SourceLinkEditor } from "./SourceLinkEditor";
import styles from "./RecipeEdit.module.css";

function draftFromRecipe(recipe: Recipe) {
  const steps = recipe.steps ?? [];
  const total = recipe.total_time_minutes ?? null;
  return {
    title: recipe.title,
    author: recipe.author ?? null,
    authorId: recipe.author_id ?? recipe.author?.id ?? null,
    cover: recipe.thumbnail_url ?? "",
    description: recipe.description ?? "",
    total,
    // A separate total may include unlisted prep or overlapping steps.
    automaticTotal: total === null || total === stepTotalMinutes(steps),
    ingredients: recipe.ingredients ?? [],
    steps,
    tags: getRecipeTags(recipe),
    tips: recipe.tips ?? [],
  };
}

type Draft = ReturnType<typeof draftFromRecipe>;

function focusRow(inputId: string) {
  requestAnimationFrame(() => document.getElementById(inputId)?.focus());
}

function RecipeEditContent({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const section = useEditorSection();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const originalDraft = useRef("");
  const [canManageCatalog, setCanManageCatalog] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [authorBusy, setAuthorBusy] = useState(false);
  const [stepsValid, setStepsValid] = useState(true);
  const locked = saving || deleting;
  const busy = locked || sourceSaving || catalogSaving || uploadingCover || authorBusy;

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const response = await apiFetch("/recipes/" + id);
        if (!response.ok) throw new Error();
        const data: Recipe = await response.json();
        if (current) {
          const initial = draftFromRecipe(data);
          originalDraft.current = JSON.stringify(initial);
          setDraft(initial);
          setRecipe(data);
        }
      } catch {
        if (current) setError("recipe.editor.loadError");
      }
    }
    async function loadPermissions() {
      try {
        const response = await apiFetch("/recipes/catalog/editor-status");
        if (!response.ok) return;
        const permissions = await response.json();
        if (current) setCanManageCatalog(Boolean(permissions.can_manage));
      } catch {
        if (current) setCanManageCatalog(false);
      }
    }
    void load();
    void loadPermissions();
    return () => { current = false; };
  }, [id]);

  function update(changes: Partial<Draft>) {
    setDraft(current => current ? { ...current, ...changes } : current);
  }

  function changeIngredient(index: number, field: keyof IngredientItem, value: string) {
    if (draft) update({ ingredients: draft.ingredients.map((item, i) => i === index ? { ...item, [field]: value } : item) });
  }

  function toggleTag(tag: RecipeTagSlug) {
    if (draft) update({ tags: draft.tags.includes(tag) ? draft.tags.filter(item => item !== tag) : [...draft.tags, tag] });
  }

  function reviewSteps() {
    section.select("recipe-steps");
    requestAnimationFrame(() => {
      const steps = document.getElementById("recipe-steps");
      const invalid = steps?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
      const pending = steps?.querySelector<HTMLInputElement>('input[type="file"]:disabled');
      const details = (invalid ?? pending)?.closest("details");
      if (details) {
        details.open = true;
        (invalid ?? details.querySelector("summary"))?.focus();
      }
    });
  }

  const total = draft?.automaticTotal ? stepTotalMinutes(draft.steps) : draft?.total;
  async function save() {
    if (!draft || !recipe || busy || !stepsValid) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/recipes/" + id, {
        method: "PATCH",
        body: JSON.stringify({
          title: draft.title.trim() || recipe.title,
          author_id: draft.authorId,
          thumbnail_url: draft.cover.trim() || null,
          ingredients: draft.ingredients.filter(item => item.name.trim()),
          description: draft.description.trim() || null,
          total_time_minutes: total,
          library_tags: draft.tags,
          steps: draft.steps,
          tips: draft.tips,
        }),
      });
      if (!response.ok) throw new Error();
      router.push("/library");
    } catch {
      setError("recipe.editor.saveError");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCatalog() {
    if (!recipe || !canManageCatalog || busy) return;
    setCatalogSaving(true);
    setError("");
    try {
      const response = await apiFetch("/recipes/" + id + "/catalog", {
        method: "POST",
        body: JSON.stringify({ is_public: !recipe.is_public_catalog }),
      });
      if (!response.ok) throw new Error();
      const updated: Recipe = await response.json();
      setRecipe(current => current ? { ...current, is_public_catalog: updated.is_public_catalog } : current);
    } catch {
      setError("recipe.editor.catalogError");
    } finally {
      setCatalogSaving(false);
    }
  }

  async function deleteRecipe() {
    if (!recipe || busy || !window.confirm(t("recipe.deleteConfirm", { title: recipe.title }))) return;
    setDeleting(true);
    setError("");
    try {
      const response = await apiFetch("/recipes/" + id, { method: "DELETE" });
      if (!response.ok) throw new Error();
      router.push("/library");
    } catch {
      setError("recipe.editor.deleteError");
    } finally {
      setDeleting(false);
    }
  }

  if (!recipe || !draft) return error
    ? <p className={styles.error} role="alert">{t(error)}</p>
    : <p className={styles.help} role="status">{t("common.loading")}</p>;

  const dirty = JSON.stringify(draft) !== originalDraft.current;
  return (
    <div className={styles.editor}>
      <nav aria-label={t("recipe.editor.breadcrumb")} className={styles.crumbs}>
        <Link href="/library">{t("nav.library")}</Link>
        <span aria-hidden="true">/</span>
        <Link href={"/recipe/" + id}>{recipe.title}</Link>
      </nav>
      <header className={styles.toolbar}>
        <div className={styles.titleRow}>
          <div className={styles.heading}>
            <h1>{t("recipe.editRecipeTitle")}</h1>
            <span className={styles.draftStatus} role="status">{dirty && t("recipe.editor.unsaved")}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push("/library")} disabled={locked}>{t("common.cancel")}</button>
            <button type="button" className={styles.saveButton} onClick={save} disabled={busy || !stepsValid}>
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
        <EditorSections active={section.active} onSelect={section.select} ingredientCount={draft.ingredients.length} stepCount={draft.steps.length} />
        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        {!stepsValid && <p className={styles.review} role="status">
          <button type="button" onClick={reviewSteps}>{t("recipe.editor.reviewSteps")}</button>
        </p>}
      </header>

      <fieldset disabled={locked} className={styles.panels}>
        <section {...section.panel("recipe-basics")} className={styles.panel}>
          <h2>{t("recipe.basicDetails")}</h2>
          <div className={styles.basicGrid}>
            <div className={styles.basicFields}>
              <label className={styles.field}>
                <span>{t("recipe.recipeTitle")}</span>
                <input type="text" value={draft.title} onChange={event => update({ title: event.target.value })} />
              </label>
              <div className={styles.authorField}>
                <AuthorPicker value={draft.author} onChange={author => update({ author, authorId: author?.id ?? null })}
                  disabled={locked || sourceSaving} onBusyChange={setAuthorBusy} />
              </div>
              <div className={styles.field}>
                <label htmlFor="edit-description">{t("recipe.description")}</label>
                <textarea id="edit-description" rows={3} maxLength={500} value={draft.description}
                  placeholder={t("recipe.description.placeholder")} onChange={event => update({ description: event.target.value })} />
                <small className={styles.counter}>{draft.description.length} / 500</small>
              </div>
              <label className={styles.field}>
                <span>{t("recipe.totalTime")}</span>
                <span className={styles.timeControl}>
                  <input type="number" min={0} value={total ?? ""} placeholder={t("recipe.totalTime.placeholder")}
                    onChange={event => update({ automaticTotal: false, total: event.target.value === "" ? null : Math.max(0, Math.floor(Number(event.target.value))) })} />
                  <span>{t("recipe.totalTime.minutesSuffix")}</span>
                </span>
              </label>
            </div>
            <div className={styles.coverColumn}>
              <RecipeCoverEditor variant="compact" value={draft.cover} onChange={cover => update({ cover })} onBusyChange={setUploadingCover} disabled={locked} />
              <details className={styles.imageOptions}>
                <summary>{t("recipe.editor.imageOptions")}<Icon name="chevronDown" size={16} /></summary>
                <label className={styles.field}>
                  <span>{t("recipe.imageUrl")}</span>
                  <input type="url" value={draft.cover} onChange={event => update({ cover: event.target.value })} disabled={uploadingCover} placeholder="https://…" />
                </label>
                <RecipeImageGenerator recipe={{ title: draft.title, description: draft.description, ingredients: draft.ingredients, steps: draft.steps }}
                  headingLevel={3} disabled={locked || uploadingCover} onAccept={cover => update({ cover })} />
              </details>
            </div>
          </div>
        </section>

        <section {...section.panel("recipe-ingredients")} className={styles.panel}>
          <h2>{t("common.ingredients")}</h2>
          <p className={styles.help} id="recipe-conversion-help">{t("recipe.metricQtyHelp")}</p>
          {draft.ingredients.length > 0 && <div className={styles.ingredientLabels} aria-hidden="true">
            <span>{t("recipe.ingredient")}</span><span>{t("recipe.originalAmount")}</span><span>{t("recipe.metricQty")}</span>
          </div>}
          <ul className={styles.ingredientRows}>
            {draft.ingredients.map((item, index) => <li key={index}>
              <label className={styles.ingredientName}>
                <span>{t("recipe.ingredient")}</span>
                <input id={"ingredient-" + index} aria-label={t("recipe.ingredient") + " " + (index + 1)} value={item.name}
                  onChange={event => changeIngredient(index, "name", event.target.value)} />
              </label>
              <label><span>{t("recipe.originalAmount")}</span>
                <input aria-label={t("recipe.originalAmount") + " " + (index + 1)} value={item.quantity ?? ""}
                  onChange={event => changeIngredient(index, "quantity", event.target.value)} />
              </label>
              <label><span>{t("recipe.metricQty")}</span>
                <input aria-label={t("recipe.metricQty") + " " + (index + 1)} aria-describedby="recipe-conversion-help" value={item.metric_quantity ?? ""}
                  onChange={event => changeIngredient(index, "metric_quantity", event.target.value)} />
              </label>
              <button type="button" className={styles.removeButton} aria-label={t("recipe.removeIngredient") + " " + (index + 1)}
                onClick={() => {
                  const next = draft.ingredients.filter((_, i) => i !== index);
                  update({ ingredients: next });
                  focusRow(next.length ? "ingredient-" + Math.min(index, next.length - 1) : "add-ingredient");
                }}><Icon name="trash" size={16} /></button>
            </li>)}
          </ul>
          <button id="add-ingredient" type="button" className={styles.addButton} onClick={() => {
            update({ ingredients: [...draft.ingredients, { name: "", quantity: "", metric_quantity: "", notes: null }] });
            focusRow("ingredient-" + draft.ingredients.length);
          }}><Icon name="add" size={16} />{t("recipe.editor.addIngredient")}</button>
        </section>

        <section {...section.panel("recipe-steps")} className={styles.panel}>
          <StepListEditor compact steps={draft.steps} sourceUrl={recipe.source_url} onChange={steps => update({ steps })} disabled={locked}
            uploadImage={file => uploadRecipeImage(file, t("common.upload"))} onValidityChange={setStepsValid} />
        </section>

        <section {...section.panel("recipe-more")} className={styles.panel}>
          <h2>{t("recipe.editor.tipsAndTags")}</h2>
          <div className={styles.tipSection}>
            <h3>{t("recipe.tips")}</h3>
            {draft.tips.map((tip, index) => <div key={index} className={styles.tipRow}>
              <textarea rows={2} id={"tip-" + index} value={tip} aria-label={t("recipe.editor.tip", { number: index + 1 })} placeholder={t("recipe.tips.placeholder")}
                onChange={event => update({ tips: draft.tips.map((value, i) => i === index ? event.target.value : value) })} />
              <button type="button" className={styles.removeButton} aria-label={t("recipe.editor.removeTip", { number: index + 1 })}
                onClick={() => {
                  const next = draft.tips.filter((_, i) => i !== index);
                  update({ tips: next });
                  focusRow(next.length ? "tip-" + Math.min(index, next.length - 1) : "add-tip");
                }}><Icon name="trash" size={16} /></button>
            </div>)}
            <button id="add-tip" type="button" className={styles.addButton} onClick={() => {
              update({ tips: [...draft.tips, ""] });
              focusRow("tip-" + draft.tips.length);
            }}><Icon name="add" size={16} />{t("recipe.tips.addRow")}</button>
          </div>
          <h3>{t("common.tags")}</h3>
          <div className={styles.tagGroups}>
            {RECIPE_TAG_GROUPS.map(group => <fieldset key={group.id}>
              <legend>{t("recipe.tagGroup." + group.id)}</legend>
              <div>{group.tags.map(tag => <button key={tag.id} type="button" aria-pressed={draft.tags.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}>{draft.tags.includes(tag.id) && <Icon name="check" size={14} />}{t("recipe.tag." + tag.id)}</button>)}</div>
            </fieldset>)}
          </div>
        </section>

        <section {...section.panel("recipe-sharing")} className={styles.panel}>
          <h2>{t("recipe.sharingAndSource")}</h2>
          <div className={styles.setting}>
            <div><h3>{t("recipe.sourceLinkLabel")}</h3><p>{t("recipe.editor.sourceHelp")}</p></div>
            <SourceLinkEditor recipeId={id} value={recipe.source_url} disabled={locked || catalogSaving} onBusyChange={setSourceSaving}
              onSaved={source_url => setRecipe(current => current ? { ...current, source_url } : current)} />
          </div>
          {canManageCatalog && <div className={styles.setting}>
            <div><h3>{t("recipe.publicLibrary")}</h3>
              <p role="status">{t(recipe.is_public_catalog ? "recipe.editor.public" : "recipe.editor.private")}</p></div>
            <button type="button" className={styles.secondaryButton} onClick={toggleCatalog} disabled={busy}>
              {catalogSaving ? t("common.saving") : t(recipe.is_public_catalog ? "recipe.removeFromPublicLibrary" : "recipe.addToPublicLibrary")}
            </button>
          </div>}
          <div className={styles.setting}>
            <div><h3>{t("recipe.deleteRecipe")}</h3><p>{t("recipe.editor.deleteHelp")}</p></div>
            <button type="button" className={styles.dangerButton} onClick={deleteRecipe} disabled={busy}>
              <Icon name="trash" size={16} />{deleting ? t("recipe.deleting") : t("common.delete")}
            </button>
          </div>
        </section>
      </fieldset>
    </div>
  );
}

export default function RecipeEditPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth><PageShell><RecipeEditContent key={id} id={id} /></PageShell></RequireAuth>;
}
