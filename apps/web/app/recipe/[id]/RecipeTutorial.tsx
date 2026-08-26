"use client";

import { useState } from "react";
import Link from "next/link";
import {
  formatRecipeStepMetadata,
  RECIPE_ACTION_MESSAGE_KEYS,
  type RecipeActionType,
} from "@cooking/shared";
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
        title={t(RECIPE_ACTION_MESSAGE_KEYS[actionType])}
      />
    </div>
  );
}

export function RecipeTutorial({ recipe }: { recipe: Recipe }) {
  const t = useT();
  const steps = recipe.steps ?? [];
  const editHref = `/recipe/${recipe.id}/tutorial/edit`;

  return (
    <section aria-labelledby="recipe-tutorial-heading" className={styles.tutorial}>
      <div className={styles.tutorialHeader}>
        <h2 className="cw-display" id="recipe-tutorial-heading">{t("recipe.steps")}</h2>
        {steps.length ? (
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
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.tutorialEmpty}>
          <p>{t("recipe.tutorial.noSteps")}</p>
          <Link href={editHref}>{t("recipe.tutorial.edit")}</Link>
        </div>
      )}
    </section>
  );
}
