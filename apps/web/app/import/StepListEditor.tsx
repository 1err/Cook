"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  createRecipeStep,
  RECIPE_ACTION_MESSAGE_KEYS,
  RECIPE_ACTION_TYPES,
  RECIPE_ATTENTION_TYPE_MESSAGE_KEYS,
  RECIPE_DURATION_SOURCE_MESSAGE_KEYS,
  type RecipeActionType,
  type RecipeStep,
} from "@cooking/shared";
import { useT } from "../lib/i18n";
import { DurationField } from "./DurationField";
import styles from "./ImportFlow.module.css";

export interface StepListEditorProps {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  uploadImage?: (file: File) => Promise<string>;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
}

function hasValidDuration(step: RecipeStep): boolean {
  return (
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
  onChange,
  uploadImage,
  onValidityChange,
  disabled = false,
}: StepListEditorProps) {
  const t = useT();
  const headingId = useId();
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [invalidStepKeys, setInvalidStepKeys] = useState<Set<string>>(() => new Set());
  const durationsValid = steps.every(
    (step, index) => hasValidDuration(step) && !invalidStepKeys.has(stepKey(step, index)),
  );
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
    onValidityChange?.(durationsValid);
  }, [durationsValid, onValidityChange]);

  async function onPickImage(index: number, file: File) {
    if (!uploadImage) return;
    setUploadingIndex(index);
    try {
      const imageUrl = await uploadImage(file);
      updateAt(index, { ...steps[index], image_url: imageUrl });
    } finally {
      setUploadingIndex(null);
    }
  }

  return (
    <fieldset
      aria-busy={disabled || undefined}
      aria-labelledby={headingId}
      className={`${styles.editorSection} ${styles.editorFieldset}`}
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
          <li key={stepKey(step, index)}>
            <span className={styles.stepIndex}>{index + 1}</span>
            <div className={styles.stepBody}>
              <textarea
                rows={3}
                aria-label={t("recipe.tutorial.editor.stepLabel", { step: index + 1 })}
                placeholder={t("recipe.step.textPlaceholder")}
                value={step.text}
                onChange={(event) => updateAt(index, { ...step, text: event.target.value })}
              />
              <div className={styles.stepMetadata}>
                <div className={styles.stepMetadataField}>
                  <span>{t("recipe.tutorial.editor.duration")}</span>
                  <span className={styles.metadataSource}>
                    {t(RECIPE_DURATION_SOURCE_MESSAGE_KEYS[step.duration_source ?? "fallback"])}
                  </span>
                </div>
                <DurationField
                  seconds={step.duration_seconds ?? null}
                  onChange={(next) => updateAt(index, {
                    ...step,
                    duration_seconds: Math.max(1, Math.min(86_400, next ?? 1)),
                    duration_source: "user",
                  })}
                  ariaLabel={t("recipe.tutorial.editor.durationLabel", { step: index + 1 })}
                  minutesAriaLabel={t("recipe.tutorial.editor.durationMinutes", { step: index + 1 })}
                  secondsAriaLabel={t("recipe.tutorial.editor.durationSeconds", { step: index + 1 })}
                  validationMessage={t("recipe.tutorial.editor.durationInvalid")}
                  onValidityChange={(valid) => reportDurationValidity(stepKey(step, index), valid)}
                />

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
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void onPickImage(index, file);
                      }}
                    />
                    {uploadingIndex === index ? "Uploading…" : t("recipe.step.uploadImage")}
                  </label>
                )
              ) : null}
            </div>
            <div className={styles.rowActions}>
              <button type="button" onClick={() => swap(index, index - 1)} aria-label={t("recipe.tutorial.editor.moveUp", { step: index + 1 })}>↑</button>
              <button type="button" onClick={() => swap(index, index + 1)} aria-label={t("recipe.tutorial.editor.moveDown", { step: index + 1 })}>↓</button>
              <button type="button" onClick={() => removeAt(index)} aria-label={t("recipe.tutorial.editor.remove", { step: index + 1 })}>×</button>
            </div>
          </li>
        ))}
      </ol>
    </fieldset>
  );
}
