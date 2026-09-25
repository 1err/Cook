"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  createRecipeStep,
  createUuid,
  editRecipeStepText,
  RECIPE_ACTION_MESSAGE_KEYS,
  RECIPE_ACTION_TYPES,
  RECIPE_ATTENTION_TYPE_MESSAGE_KEYS,
  RECIPE_DURATION_SOURCE_MESSAGE_KEYS,
  type RecipeActionType,
  type RecipeStep,
} from "@cooking/shared";
import { useT } from "../lib/i18n";
import { StepEvidence } from "./StepEvidence";
import { DurationField } from "./DurationField";
import styles from "./StepListEditor.module.css";

export interface StepListEditorProps {
  steps: RecipeStep[];
  sourceUrl?: string | null;
  onChange: (next: RecipeStep[]) => void;
  uploadImage?: (file: File) => Promise<string>;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
  estimateOnEdit?: boolean;
}

function hasValidDuration(step: RecipeStep): boolean {
  return step.duration_seconds == null || (
    typeof step.duration_seconds === "number" &&
    Number.isInteger(step.duration_seconds) &&
    step.duration_seconds >= 1 &&
    step.duration_seconds <= 86_400
  );
}

function stepKey(step: RecipeStep, index: number): string {
  return step.id ?? `legacy-step-${index}`;
}

export function StepListEditor({
  steps,
  sourceUrl,
  onChange,
  uploadImage,
  onValidityChange,
  disabled = false,
  estimateOnEdit = false,
}: StepListEditorProps) {
  const t = useT();
  const headingId = useId();
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(() => new Set());
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const pendingUploads = useRef(new Set<string>());
  const mounted = useRef(true);
  const latest = useRef({ steps, onChange, disabled });
  latest.current = { steps, onChange, disabled };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [invalidStepKeys, setInvalidStepKeys] = useState<Set<string>>(() => new Set());
  const durationsValid = steps.every(
    (step, index) => hasValidDuration(step) && !invalidStepKeys.has(stepKey(step, index)),
  );
  const hasPendingImages = steps.some(step => step.id && uploadingIds.has(step.id));
  const updateAt = (index: number, next: RecipeStep) => {
    const updated = steps.slice();
    updated[index] = next;
    onChange(updated);
  };
  const removeAt = (index: number) => onChange(steps.filter((_, itemIndex) => itemIndex !== index));
  const swap = (index: number, nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    const updated = steps.slice();
    [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
    onChange(updated);
  };

  const reportDurationValidity = useCallback((key: string, valid: boolean) => {
    setInvalidStepKeys((current) => {
      const next = new Set(current);
      if (valid) next.delete(key);
      else next.add(key);
      if (next.size === current.size && [...next].every((item) => current.has(item))) return current;
      return next;
    });
  }, []);

  useEffect(() => {
    // Parent save controls wait for the chosen images as well as valid timers.
    onValidityChange?.(durationsValid && !hasPendingImages);
  }, [durationsValid, hasPendingImages, onValidityChange]);

  async function onPickImage(index: number, file: File) {
    const current = latest.current;
    const step = current.steps[index];
    if (!uploadImage || current.disabled || !step) return;
    const needsId = !step.id || current.steps.filter(item => item.id === step.id).length !== 1;
    const id = needsId ? createUuid() : step.id!;
    if (pendingUploads.current.has(id)) return;
    if (needsId) {
      const identified = current.steps.map((item, itemIndex) => itemIndex === index ? { ...item, id } : item);
      latest.current = { ...current, steps: identified };
      current.onChange(identified);
    }
    pendingUploads.current.add(id);
    setUploadingIds(new Set(pendingUploads.current));
    setImageErrors(errors => { const next = { ...errors }; delete next[id]; return next; });
    try {
      const imageUrl = await uploadImage(file);
      if (!mounted.current) return;
      const updated = latest.current;
      // The user can edit, reorder or remove steps while storage is pending.
      if (updated.steps.filter(item => item.id === id).length !== 1) return;
      const next = updated.steps.map(item => item.id === id ? { ...item, image_url: imageUrl } : item);
      latest.current = { ...updated, steps: next };
      updated.onChange(next);
    } catch {
      if (mounted.current && latest.current.steps.some(item => item.id === id)) {
        setImageErrors(errors => ({ ...errors, [id]: t("recipe.step.imageUploadFailed") }));
      }
    } finally {
      pendingUploads.current.delete(id);
      if (mounted.current) setUploadingIds(new Set(pendingUploads.current));
    }
  }

  return (
    <fieldset
      aria-busy={disabled || undefined}
      aria-labelledby={headingId}
      className={styles.editor}
      disabled={disabled}
    >
      <div className={styles.sectionHeader}>
        <h2 className="cw-display" id={headingId}>{t("recipe.steps")}</h2>
        <button
          type="button"
          aria-label={t("recipe.step.addRow")}
          onClick={() => onChange([...steps, createRecipeStep()])}
        >
          + {t("recipe.step.addRow")}
        </button>
      </div>
      {steps.length === 0 ? <p className={styles.muted}>{t("recipe.steps.empty")}</p> : null}
      <ol className={styles.stepRows}>
        {steps.map((step, index) => (
          <li key={stepKey(step, index)} className={styles.stepCard}>
            <div className={styles.stepHeader}>
              <span className={styles.stepHeading}>{t("recipe.tutorial.editor.stepLabel", { step: index + 1 })}</span>
              <div className={styles.rowActions}>
                <button type="button" disabled={index === 0} onClick={() => swap(index, index - 1)} aria-label={t("recipe.tutorial.editor.moveUp", { step: index + 1 })}>↑</button>
                <button type="button" disabled={index === steps.length - 1} onClick={() => swap(index, index + 1)} aria-label={t("recipe.tutorial.editor.moveDown", { step: index + 1 })}>↓</button>
                <button type="button" onClick={() => removeAt(index)} aria-label={t("recipe.tutorial.editor.remove", { step: index + 1 })}>×</button>
              </div>
            </div>
            <div className={styles.stepBody}>
              <textarea
                rows={3}
                aria-label={t("recipe.tutorial.editor.stepLabel", { step: index + 1 })}
                placeholder={t("recipe.step.textPlaceholder")}
                value={step.text}
                onChange={(event) => updateAt(index, editRecipeStepText(step, event.target.value, estimateOnEdit))}
              />
              <StepEvidence step={step} sourceUrl={sourceUrl} showSuggestedWarning />
              <div className={styles.stepMetadata}>
                <div className={styles.durationControl}>
                  <div className={styles.metadataLabel}>
                    <span>{t("recipe.tutorial.editor.duration")}</span>
                    <span className={styles.metadataSource}>
                      {t(RECIPE_DURATION_SOURCE_MESSAGE_KEYS[step.duration_source ?? "unknown"])}
                    </span>
                  </div>
                  <DurationField
                    seconds={step.duration_seconds ?? null}
                    onChange={(next) => updateAt(index, {
                      ...step,
                      duration_seconds: next,
                      duration_source: next == null ? "unknown" : "user",
                    })}
                    ariaLabel={t("recipe.tutorial.editor.durationLabel", { step: index + 1 })}
                    minutesAriaLabel={t("recipe.tutorial.editor.durationMinutes", { step: index + 1 })}
                    secondsAriaLabel={t("recipe.tutorial.editor.durationSeconds", { step: index + 1 })}
                    validationMessage={t("recipe.tutorial.editor.durationInvalid")}
                    onValidityChange={(valid) => reportDurationValidity(stepKey(step, index), valid)}
                  />
                </div>

                <fieldset className={styles.attentionControl}>
                  <legend>{t("recipe.tutorial.editor.attention")}</legend>
                  <div>
                    {(["hands_on", "passive"] as const).map((attentionType) => (
                      <button
                        key={attentionType}
                        type="button"
                        aria-pressed={(step.attention_type ?? "hands_on") === attentionType}
                        onClick={() => updateAt(index, {
                          ...step,
                          attention_type: attentionType,
                        })}
                      >
                        {t(RECIPE_ATTENTION_TYPE_MESSAGE_KEYS[attentionType])}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className={styles.actionControl}>
                  <span>{t("recipe.tutorial.editor.illustration")}</span>
                  <select
                    value={step.action_type ?? "other"}
                    aria-label={t("recipe.tutorial.editor.illustrationLabel", { step: index + 1 })}
                    onChange={(event) => updateAt(index, {
                      ...step,
                      action_type: event.target.value as RecipeActionType,
                    })}
                  >
                    {RECIPE_ACTION_TYPES.map((actionType) => (
                      <option key={actionType} value={actionType}>
                        {t(RECIPE_ACTION_MESSAGE_KEYS[actionType])}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {uploadImage ? (
                step.image_url ? (
                  <div className={styles.stepImage}>
                    <img src={step.image_url} alt="" />
                    <button type="button" onClick={() => updateAt(index, { ...step, image_url: null })}>
                      {t("recipe.step.removeImage")}
                    </button>
                  </div>
                ) : (
                  <label className={styles.stepUpload}>
                    <input
                      type="file"
                      accept="image/*"
                      aria-label={t("recipe.step.imageUploadLabel", { step: index + 1 })}
                      disabled={uploadingIds.has(step.id ?? "")}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void onPickImage(index, file);
                      }}
                    />
                    <span role={uploadingIds.has(step.id ?? "") ? "status" : undefined}>
                      {uploadingIds.has(step.id ?? "") ? t("recipe.uploading") : t("recipe.step.uploadImage")}
                    </span>
                  </label>
                )
              ) : null}
              {imageErrors[step.id ?? ""] ? <p role="alert">{imageErrors[step.id ?? ""]}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </fieldset>
  );
}
