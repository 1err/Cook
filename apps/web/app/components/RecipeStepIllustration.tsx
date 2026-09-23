"use client";

import type { ReactNode } from "react";
import type { RecipeActionType } from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./RecipeStepIllustration.module.css";
import {
  resolveRecipeStepVisual,
  type RecipeStepIngredientVariant,
} from "./recipeStepVisual";

type RecipeStepIllustrationProps = {
  actionType: RecipeActionType | null | undefined;
  title: string;
  size?: number;
  decorative?: boolean;
};

const VIEW_BOX = "0 0 112 112";

function Frame({ children }: { children: ReactNode }) {
  return (
    <>
      <circle className={styles.halo} cx="56" cy="56" r="51" />
      <circle className={styles.haloInset} cx="56" cy="56" r="43" />
      {children}
    </>
  );
}

function Steam({ x }: { x: number }) {
  return (
    <path
      className={styles.steam}
      d={`M${x} 35c-4-4 4-7 0-12M${x + 10} 36c-4-4 4-7 0-12`}
    />
  );
}

function PrepArt() {
  return (
    <Frame>
      <path className={styles.sageFill} d="M33 66h46c-2 14-10 21-23 21S35 80 33 66Z" />
      <path className={styles.creamFill} d="M31 62c0-5 11-9 25-9s25 4 25 9-11 9-25 9-25-4-25-9Z" />
      <path className={styles.terracottaFill} d="M54 54c-8-3-12-9-11-17 8 0 14 5 15 13" />
      <path className={styles.sageDarkFill} d="M58 51c1-9 7-14 15-15 1 8-3 14-12 18" />
      <path d="M56 66v-17" />
      <path d="M33 66h46c-2 14-10 21-23 21S35 80 33 66Z" />
    </Frame>
  );
}

function ChopPieces({ variant }: { variant: RecipeStepIngredientVariant }) {
  if (variant === "tofu") {
    return (
      <>
        <rect className={styles.butterFill} height="12" rx="2" width="14" x="35" y="61" />
        <rect className={styles.butterFill} height="11" rx="2" width="13" x="51" y="66" />
        <rect className={styles.butterFill} height="10" rx="2" width="12" x="65" y="59" />
      </>
    );
  }
  if (variant === "meat") {
    return (
      <>
        <path className={styles.terracottaFill} d="M34 68c3-8 13-11 19-4 4 6-3 12-10 12-6 0-11-3-9-8Z" />
        <path className={styles.terracottaFill} d="M58 66c2-7 11-9 17-4 4 5-1 11-8 12-6 1-11-2-9-8Z" />
        <path className={styles.creamStroke} d="m39 68 9 3m14-5 8 3" />
      </>
    );
  }
  if (variant === "vegetable") {
    return (
      <>
        <path className={styles.sageFill} d="m34 72 9-13 9 13Z" />
        <path className={styles.terracottaFill} d="M55 60c9 0 15 6 15 14H55Z" />
        <path className={styles.butterFill} d="m72 72 6-12 7 12Z" />
      </>
    );
  }
  return (
    <>
      <circle className={styles.sageFill} cx="43" cy="69" r="7" />
      <circle className={styles.terracottaFill} cx="60" cy="70" r="6" />
      <circle className={styles.butterFill} cx="75" cy="67" r="6" />
    </>
  );
}

function ChopArt({ variant }: { variant: RecipeStepIngredientVariant }) {
  return (
    <Frame>
      <rect className={styles.boardFill} height="42" rx="8" width="61" x="26" y="48" />
      <circle className={styles.surfaceDot} cx="80" cy="83" r="2.5" />
      <ChopPieces variant={variant} />
      <path className={styles.knifeFill} d="M29 47c13-9 31-12 49-8-8 12-22 19-41 18Z" />
      <path d="m36 56-7-9m49-8 9-4" />
      <path className={styles.knifeHandle} d="M77 39 91 32c4-2 7 4 3 7l-16 8" />
    </Frame>
  );
}

function MixArt() {
  return (
    <Frame>
      <path className={styles.butterFill} d="M29 59h55c-2 18-12 29-28 29S31 77 29 59Z" />
      <path className={styles.creamFill} d="M29 59c0-5 12-9 27-9s28 4 28 9-13 9-28 9-27-4-27-9Z" />
      <path d="M29 59h55c-2 18-12 29-28 29S31 77 29 59Z" />
      <path className={styles.accentStroke} d="M43 58c7-4 19-4 27 0" />
      <path d="m72 25-15 32" />
      <path d="M65 30c8 2 12 7 9 12s-9 3-14-1m9-5c8 2 11 6 9 10-3 5-10 3-15-1" />
    </Frame>
  );
}

function SeasonArt() {
  return (
    <Frame>
      <path className={styles.sageFill} d="M30 68h53c-3 13-12 20-26 20S34 81 30 68Z" />
      <path d="M30 68h53c-3 13-12 20-26 20S34 81 30 68Z" />
      <g transform="rotate(-24 61 39)">
        <rect className={styles.butterFill} height="28" rx="7" width="19" x="52" y="25" />
        <path d="M52 34h19m-14-8v-4m5 4v-4m5 5v-4" />
      </g>
      <circle className={styles.terracottaFill} cx="47" cy="53" r="2" />
      <circle className={styles.terracottaFill} cx="55" cy="58" r="2" />
      <circle className={styles.terracottaFill} cx="63" cy="53" r="2" />
    </Frame>
  );
}

function SearArt() {
  return (
    <Frame>
      <Steam x={44} />
      <path className={styles.inkFill} d="M75 65h21c5 0 5 7 0 8H74Z" />
      <path className={styles.terracottaFill} d="M25 57h54v9c0 12-10 21-27 21S25 78 25 66Z" />
      <path className={styles.creamFill} d="M25 57c0-6 12-10 27-10s27 4 27 10-12 10-27 10-27-4-27-10Z" />
      <path className={styles.sageFill} d="M39 57c2-7 10-10 17-6 5 3 6 8 3 12-8 2-15 0-20-6Z" />
      <path d="M25 57v9c0 12 10 21 27 21s27-9 27-21v-9" />
    </Frame>
  );
}

function SimmerArt() {
  return (
    <Frame>
      <Steam x={43} />
      <path className={styles.sageFill} d="M30 53h52v30c0 5-4 8-9 8H39c-5 0-9-3-9-8Z" />
      <path className={styles.butterFill} d="M26 48h60v8H26Z" />
      <path d="M35 47c3-8 11-12 21-12s18 4 21 12m-21-12v-5" />
      <circle className={styles.terracottaFill} cx="44" cy="68" r="3" />
      <circle className={styles.terracottaFill} cx="57" cy="76" r="2.5" />
      <circle className={styles.terracottaFill} cx="69" cy="66" r="3" />
      <path d="M30 56v27c0 5 4 8 9 8h34c5 0 9-3 9-8V56" />
    </Frame>
  );
}

function BoilArt() {
  return (
    <Frame>
      <Steam x={42} />
      <path className={styles.butterFill} d="M30 51h52v34c0 5-4 8-9 8H39c-5 0-9-3-9-8Z" />
      <path className={styles.waterFill} d="M35 61c7-4 14 3 21 0s14 3 21 0v20H35Z" />
      <path d="M24 55h64M30 51v34c0 5 4 8 9 8h34c5 0 9-3 9-8V51" />
      <circle className={styles.creamFill} cx="45" cy="73" r="3" />
      <circle className={styles.creamFill} cx="58" cy="67" r="2.5" />
      <circle className={styles.creamFill} cx="69" cy="77" r="3" />
    </Frame>
  );
}

function BakeArt() {
  return (
    <Frame>
      <rect className={styles.sageFill} height="67" rx="9" width="62" x="25" y="24" />
      <path className={styles.creamFill} d="M31 43h50v39H31Z" />
      <circle className={styles.butterFill} cx="38" cy="34" r="4" />
      <circle className={styles.butterFill} cx="50" cy="34" r="4" />
      <path d="M31 43h50v39H31Zm8 27h34" />
      <path className={styles.terracottaFill} d="M39 63c4-9 10-13 17-13s13 4 17 13Z" />
      <path className={styles.creamStroke} d="M49 58c4-2 9-2 13 0" />
    </Frame>
  );
}

function RestArt() {
  return (
    <Frame>
      <path className={styles.butterFill} d="M26 63h53c-2 17-11 26-26 26S29 80 26 63Z" />
      <path d="M26 63h53c-2 17-11 26-26 26S29 80 26 63Zm4-5c6-9 14-13 24-13s18 4 24 13" />
      <path className={styles.sageFill} d="M31 58c6-8 13-11 23-11s17 3 23 11Z" />
      <circle className={styles.creamFill} cx="79" cy="38" r="16" />
      <path d="M79 28v11l7 4" />
      <circle className={styles.terracottaFill} cx="79" cy="38" r="2.5" />
    </Frame>
  );
}

function DrainArt() {
  return (
    <Frame>
      <path className={styles.sageFill} d="M28 48h56c-2 20-12 31-28 31S30 68 28 48Z" />
      <path d="M22 49h68M28 48c2 20 12 31 28 31s26-11 28-31M56 79v8m-12 0h24" />
      {[39, 49, 59, 69].map((cx) => (
        <circle className={styles.creamFill} cx={cx} cy="59" key={cx} r="2.5" />
      ))}
      <path className={styles.waterStroke} d="M41 82c0 5-5 5-5 0m20 4c0 6-6 6-6 0m22-4c0 5-5 5-5 0" />
    </Frame>
  );
}

function AssembleArt() {
  return (
    <Frame>
      <path className={styles.creamFill} d="M27 74c8-24 20-36 29-36s21 12 29 36c-9 9-18 14-29 14S36 83 27 74Z" />
      <path className={styles.sageFill} d="M36 69c8-9 14-13 20-13s13 4 20 13c-6 5-13 8-20 8s-14-3-20-8Z" />
      <path className={styles.terracottaFill} d="M41 62c5-7 10-10 15-10s10 3 15 10c-5 3-10 5-15 5s-10-2-15-5Z" />
      <path d="M27 74c8-24 20-36 29-36s21 12 29 36c-9 9-18 14-29 14S36 83 27 74Z" />
      <path className={styles.accentStroke} d="m38 42 8 8m28-8-8 8" />
    </Frame>
  );
}

function PlateArt() {
  return (
    <Frame>
      <circle className={styles.creamFill} cx="56" cy="60" r="31" />
      <circle className={styles.butterFill} cx="56" cy="60" r="22" />
      <path className={styles.terracottaFill} d="M39 67c7-17 27-22 36-4-8 13-25 17-36 4Z" />
      <path className={styles.sageFill} d="M54 48c-6-8-5-15 2-21 6 6 6 13 1 21m2 0c5-8 11-10 18-6-3 8-9 11-18 9" />
      <path d="M56 50v16" />
    </Frame>
  );
}

function OtherArt() {
  return (
    <Frame>
      <Steam x={43} />
      <path className={styles.terracottaFill} d="M28 59h56c-3 19-13 29-28 29S31 78 28 59Z" />
      <path className={styles.creamFill} d="M28 59c0-5 13-9 28-9s28 4 28 9-13 9-28 9-28-4-28-9Z" />
      <path className={styles.sageFill} d="M53 55c-6-7-5-13 1-18 6 5 6 11 2 17m1 0c5-6 10-7 15-3-3 6-8 8-15 6" />
      <path d="M28 59h56c-3 19-13 29-28 29S31 78 28 59Z" />
    </Frame>
  );
}

function IllustrationArt({ actionType, ingredientVariant }: {
  actionType: RecipeActionType;
  ingredientVariant: RecipeStepIngredientVariant;
}) {
  switch (actionType) {
    case "prep": return <PrepArt />;
    case "chop": return <ChopArt variant={ingredientVariant} />;
    case "mix": return <MixArt />;
    case "season": return <SeasonArt />;
    case "sear": return <SearArt />;
    case "simmer": return <SimmerArt />;
    case "boil": return <BoilArt />;
    case "bake": return <BakeArt />;
    case "rest": return <RestArt />;
    case "drain": return <DrainArt />;
    case "assemble": return <AssembleArt />;
    case "plate": return <PlateArt />;
    case "other": return <OtherArt />;
  }
}

export function RecipeStepIllustration({
  actionType,
  decorative = false,
  size = 112,
  title,
}: RecipeStepIllustrationProps) {
  const t = useT();
  const label = t("recipe.tutorial.illustrationLabel", { action: title });
  const visual = resolveRecipeStepVisual(actionType, title);

  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className={styles.illustration}
      data-action={visual.actionType}
      data-ingredient-variant={visual.ingredientVariant}
      height={size}
      role={decorative ? undefined : "img"}
      viewBox={VIEW_BOX}
      width={size}
    >
      {decorative ? null : <title>{label}</title>}
      <IllustrationArt {...visual} />
    </svg>
  );
}

export type { RecipeStepIllustrationProps };
