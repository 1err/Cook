"use client";

import {
  getRecipeActionIllustration,
  RECIPE_ACTION_ILLUSTRATION_VIEW_BOX,
  type RecipeActionType,
  type RecipeVectorPaletteRole,
} from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./RecipeStepIllustration.module.css";

type RecipeStepIllustrationProps = {
  actionType: RecipeActionType | null | undefined;
  title: string;
  size?: number;
  decorative?: boolean;
};

const paletteClasses: Record<RecipeVectorPaletteRole, string> = {
  accent: styles.accent,
  ink: styles.ink,
  surface: styles.surface,
};

export function RecipeStepIllustration({
  actionType,
  decorative = false,
  size = 112,
  title,
}: RecipeStepIllustrationProps) {
  const t = useT();
  const label = t("recipe.tutorial.illustrationLabel", { action: title });
  const primitives = getRecipeActionIllustration(actionType);

  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className={styles.illustration}
      height={size}
      role={decorative ? undefined : "img"}
      viewBox={RECIPE_ACTION_ILLUSTRATION_VIEW_BOX}
      width={size}
    >
      {decorative ? null : <title>{label}</title>}
      {primitives.map((primitive, index) => {
        if (primitive.kind === "path") {
          return (
            <path
              className={primitive.fill ? paletteClasses[primitive.fill] : undefined}
              d={primitive.d}
              key={`path-${index}`}
            />
          );
        }
        if (primitive.kind === "circle") {
          return (
            <circle
              className={primitive.fill ? paletteClasses[primitive.fill] : undefined}
              cx={primitive.cx}
              cy={primitive.cy}
              key={`circle-${index}`}
              r={primitive.r}
            />
          );
        }
        return (
          <line
            key={`line-${index}`}
            x1={primitive.x1}
            x2={primitive.x2}
            y1={primitive.y1}
            y2={primitive.y2}
          />
        );
      })}
    </svg>
  );
}

export type { RecipeStepIllustrationProps };
