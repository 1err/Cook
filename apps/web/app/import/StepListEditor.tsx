"use client";

import { useState } from "react";
import type { RecipeStep } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { DurationField } from "./DurationField";
import styles from "./ImportFlow.module.css";

export interface StepListEditorProps {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  uploadImage?: (file: File) => Promise<string>;
}

export function StepListEditor({ steps, onChange, uploadImage }: StepListEditorProps) {
  const t = useT();
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
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
    <section className={styles.editorSection}>
      <div className={styles.sectionHeader}>
        <h2 className="cw-display">{t("recipe.steps")}</h2>
        <button type="button" onClick={() => onChange([...steps, { text: "" }])}>
          + {t("recipe.step.addRow")}
        </button>
      </div>
      {steps.length === 0 ? <p className={styles.muted}>{t("recipe.steps.empty")}</p> : null}
      <ol className={styles.stepRows}>
        {steps.map((step, index) => (
          <li key={index}>
            <span className={styles.stepIndex}>{index + 1}</span>
            <div className={styles.stepBody}>
              <textarea
                rows={3}
                aria-label={`Step ${index + 1}`}
                placeholder={t("recipe.step.textPlaceholder")}
                value={step.text}
                onChange={(event) => updateAt(index, { ...step, text: event.target.value })}
              />
              <div className={styles.stepDuration}>
                <span>{t("recipe.step.duration")}</span>
                <DurationField
                  seconds={step.duration_seconds ?? null}
                  onChange={(next) => updateAt(index, { ...step, duration_seconds: next })}
                  ariaLabel={`step ${index + 1} duration`}
                />
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
              <button type="button" onClick={() => swap(index, index - 1)} aria-label={t("recipe.step.moveUp")}>↑</button>
              <button type="button" onClick={() => swap(index, index + 1)} aria-label={t("recipe.step.moveDown")}>↓</button>
              <button type="button" onClick={() => removeAt(index)} aria-label={t("recipe.step.remove")}>×</button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
