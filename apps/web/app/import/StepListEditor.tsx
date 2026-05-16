"use client";

import { useState } from "react";
import type { RecipeStep } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { DurationField } from "./DurationField";

export interface StepListEditorProps {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  uploadImage: (file: File) => Promise<string>;
}

export function StepListEditor({ steps, onChange, uploadImage }: StepListEditorProps) {
  const t = useT();
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  const updateAt = (i: number, next: RecipeStep) => {
    const arr = steps.slice();
    arr[i] = next;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= steps.length) return;
    const arr = steps.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const append = () => onChange([...steps, { text: "" }]);

  const onPickImage = async (i: number, file: File) => {
    setUploadingIndex(i);
    try {
      const url = await uploadImage(file);
      updateAt(i, { ...steps[i], image_url: url });
    } finally {
      setUploadingIndex(null);
    }
  };

  return (
    <section className="step-list-editor">
      <label className="field-label">{t("recipe.steps")}</label>
      {steps.length === 0 && <p className="hint">{t("recipe.steps.empty")}</p>}
      <ol>
        {steps.map((step, i) => (
          <li key={i} className="step-row">
            <div className="step-row__index">{i + 1}</div>
            <div className="step-row__body">
              <textarea
                rows={2}
                placeholder={t("recipe.step.textPlaceholder")}
                value={step.text}
                onChange={(e) => updateAt(i, { ...step, text: e.target.value })}
              />
              <div className="step-row__meta">
                <label>{t("recipe.step.duration")}</label>
                <DurationField
                  seconds={step.duration_seconds ?? null}
                  onChange={(next) => updateAt(i, { ...step, duration_seconds: next })}
                  ariaLabel={`step ${i + 1} duration`}
                />
              </div>
              {step.image_url ? (
                <div className="step-row__image">
                  <img src={step.image_url} alt="" />
                  <button type="button" onClick={() => updateAt(i, { ...step, image_url: null })}>
                    {t("recipe.step.removeImage")}
                  </button>
                </div>
              ) : (
                <label className="step-row__upload">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && onPickImage(i, e.target.files[0])}
                  />
                  {uploadingIndex === i ? "Uploading…" : t("recipe.step.uploadImage")}
                </label>
              )}
            </div>
            <div className="step-row__actions">
              <button type="button" onClick={() => swap(i, i - 1)} aria-label={t("recipe.step.moveUp")}>↑</button>
              <button type="button" onClick={() => swap(i, i + 1)} aria-label={t("recipe.step.moveDown")}>↓</button>
              <button type="button" onClick={() => removeAt(i)} aria-label={t("recipe.step.remove")}>×</button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="add-row-btn" onClick={append}>
        + {t("recipe.step.addRow")}
      </button>
    </section>
  );
}
