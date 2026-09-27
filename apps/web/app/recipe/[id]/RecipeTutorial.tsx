"use client";

import { useState } from "react";
import Link from "next/link";
import {
  formatRecipeStepMetadata,
  type RecipeActionType,
} from "@cooking/shared";
import { StepEvidence } from "../../import/StepEvidence";
import { RecipeStepIllustration } from "../../components/RecipeStepIllustration";
import { useT } from "../../lib/i18n";
import type { Recipe, RecipeStep } from "../../types";
import styles from "./RecipeDetail.module.css";

type StepVisualProps = {
  index: number;
  step: RecipeStep;
};

function StepVisual({ index, step }: StepVisualProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const t = useT();
  const actionType: RecipeActionType = step.action_type ?? "other";

  if (step.image_url && !imageFailed) {
    return (
      <img
        alt={t("recipe.tutorial.stepImageAlt", { step: index + 1 })}
        className={styles.stepVisual}
        onError={() => setImageFailed(true)}
        src={step.image_url}
      />
    );
  }

  return (
    <div className={styles.stepIllustration}>
      <RecipeStepIllustration
        actionType={actionType}
        decorative
        title={step.text}
      />
    </div>
  );
}

export function RecipeTutorial({ recipe, canEdit = true }: { recipe: Recipe; canEdit?: boolean }) {
  const t = useT();
  const steps = recipe.steps ?? [];
  const editHref = `/recipe/${recipe.id}/tutorial/edit`;

  return (
    <section aria-labelledby="recipe-tutorial-heading" className={styles.tutorial}>
      <div className={styles.tutorialHeader}>
        <h2 className="cw-display" id="recipe-tutorial-heading">{t("recipe.steps")}</h2>
        {steps.length && canEdit ? (
          <Link className={styles.editTutorial} href={editHref}>{t("recipe.tutorial.edit")}</Link>
        ) : null}
      </div>
      {steps.length ? (
        <ol className={styles.tutorialSteps}>
          {steps.map((step, index) => (
            <li key={step.id!}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <StepVisual index={index} step={step} />
              <div className={styles.stepContent}>
                <small>{formatRecipeStepMetadata(step, t)}</small>
                <p>{step.text}</p>
                <StepEvidence step={step} sourceUrl={recipe.source_url} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.tutorialEmpty}>
          <p>{t(canEdit ? "recipe.tutorial.noSteps" : "recipe.tutorial.noPublicSteps")}</p>
          {canEdit ? <Link href={editHref}>{t("recipe.tutorial.edit")}</Link> : null}
        </div>
      )}
    </section>
  );
}
