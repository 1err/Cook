import type { RecipeStep } from "./types";

export const RECIPE_ACTION_TYPES = [
  "prep",
  "chop",
  "mix",
  "season",
  "sear",
  "simmer",
  "boil",
  "bake",
  "rest",
  "drain",
  "assemble",
  "plate",
  "other",
] as const;

export type RecipeDurationSource =
  | "stated"
  | "estimated"
  | "user"
  | "fallback";
export type RecipeAttentionType = "hands_on" | "passive";
export type RecipeActionType = (typeof RECIPE_ACTION_TYPES)[number];

export type CanonicalRecipeStep = RecipeStep & {
  id: string;
  duration_seconds: number;
  duration_source: RecipeDurationSource;
  attention_type: RecipeAttentionType;
  action_type: RecipeActionType;
};

export const RECIPE_DURATION_SOURCE_MESSAGE_KEYS = {
  stated: "recipe.tutorial.source.stated",
  estimated: "recipe.tutorial.source.estimated",
  user: "recipe.tutorial.source.user",
  fallback: "recipe.tutorial.source.fallback",
} as const satisfies Record<RecipeDurationSource, string>;

export const RECIPE_ATTENTION_TYPE_MESSAGE_KEYS = {
  hands_on: "recipe.tutorial.attention.handsOn",
  passive: "recipe.tutorial.attention.passive",
} as const satisfies Record<RecipeAttentionType, string>;

export const RECIPE_ACTION_MESSAGE_KEYS = {
  prep: "recipe.tutorial.action.prep",
  chop: "recipe.tutorial.action.chop",
  mix: "recipe.tutorial.action.mix",
  season: "recipe.tutorial.action.season",
  sear: "recipe.tutorial.action.sear",
  simmer: "recipe.tutorial.action.simmer",
  boil: "recipe.tutorial.action.boil",
  bake: "recipe.tutorial.action.bake",
  rest: "recipe.tutorial.action.rest",
  drain: "recipe.tutorial.action.drain",
  assemble: "recipe.tutorial.action.assemble",
  plate: "recipe.tutorial.action.plate",
  other: "recipe.tutorial.action.other",
} as const satisfies Record<RecipeActionType, string>;

// Label aliases keep the maps discoverable for consumers that describe UI copy
// as labels rather than messages.
export const RECIPE_DURATION_SOURCE_LABEL_KEYS =
  RECIPE_DURATION_SOURCE_MESSAGE_KEYS;
export const RECIPE_ATTENTION_TYPE_LABEL_KEYS =
  RECIPE_ATTENTION_TYPE_MESSAGE_KEYS;
export const RECIPE_ATTENTION_MESSAGE_KEYS =
  RECIPE_ATTENTION_TYPE_MESSAGE_KEYS;
export const RECIPE_ACTION_LABEL_KEYS = RECIPE_ACTION_MESSAGE_KEYS;

export type RecipeVectorPaletteRole = "accent" | "ink" | "surface";

export type RecipeVectorPrimitive =
  | {
      kind: "path";
      d: string;
      fill?: RecipeVectorPaletteRole;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
      fill?: RecipeVectorPaletteRole;
    }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };

export const RECIPE_ACTION_ILLUSTRATION_VIEW_BOX = "0 0 48 48" as const;

export const RECIPE_ACTION_ILLUSTRATIONS = {
  prep: [
    { kind: "path", d: "M8 13 Q8 9 12 9 H36 Q40 9 40 13 V35 Q40 39 36 39 H12 Q8 39 8 35 Z", fill: "surface" },
    { kind: "circle", cx: 16, cy: 21, r: 4, fill: "accent" },
    { kind: "circle", cx: 27, cy: 19, r: 3, fill: "ink" },
    { kind: "path", d: "M24 31 Q30 25 36 31 Q30 35 24 31 Z", fill: "accent" },
  ],
  chop: [
    { kind: "path", d: "M7 32 Q18 17 34 12 L37 30 Q25 35 7 32 Z", fill: "surface" },
    { kind: "path", d: "M31 11 Q36 7 40 10 L42 13 L36 18 Z", fill: "ink" },
    { kind: "line", x1: 8, y1: 38, x2: 40, y2: 38 },
  ],
  mix: [
    { kind: "path", d: "M7 24 Q9 39 24 40 Q39 39 41 24 Z", fill: "accent" },
    { kind: "line", x1: 12, y1: 24, x2: 40, y2: 24 },
    { kind: "line", x1: 31, y1: 8, x2: 21, y2: 30 },
    { kind: "circle", cx: 32, cy: 8, r: 2, fill: "ink" },
  ],
  season: [
    { kind: "path", d: "M15 19 Q15 15 19 15 H29 Q33 15 33 19 L36 39 H12 Z", fill: "surface" },
    { kind: "path", d: "M17 9 Q24 5 31 9 L30 15 H18 Z", fill: "accent" },
    { kind: "circle", cx: 21, cy: 10, r: 1, fill: "ink" },
    { kind: "circle", cx: 27, cy: 10, r: 1, fill: "ink" },
  ],
  sear: [
    { kind: "path", d: "M7 25 Q9 38 23 38 Q37 38 39 25 Z", fill: "ink" },
    { kind: "line", x1: 38, y1: 28, x2: 45, y2: 21 },
    { kind: "path", d: "M14 24 Q23 16 32 24 Q23 29 14 24 Z", fill: "accent" },
    { kind: "line", x1: 17, y1: 15, x2: 19, y2: 9 },
    { kind: "line", x1: 27, y1: 15, x2: 29, y2: 9 },
  ],
  simmer: [
    { kind: "path", d: "M9 21 H39 L36 40 H12 Z", fill: "surface" },
    { kind: "line", x1: 7, y1: 21, x2: 41, y2: 21 },
    { kind: "line", x1: 17, y1: 16, x2: 15, y2: 8 },
    { kind: "line", x1: 29, y1: 16, x2: 31, y2: 8 },
    { kind: "circle", cx: 24, cy: 30, r: 2, fill: "accent" },
  ],
  boil: [
    { kind: "path", d: "M9 20 H39 L36 40 H12 Z", fill: "accent" },
    { kind: "line", x1: 7, y1: 20, x2: 41, y2: 20 },
    { kind: "circle", cx: 16, cy: 13, r: 3, fill: "surface" },
    { kind: "circle", cx: 25, cy: 9, r: 4, fill: "surface" },
    { kind: "circle", cx: 34, cy: 14, r: 2, fill: "surface" },
  ],
  bake: [
    { kind: "path", d: "M7 8 Q7 5 10 5 H38 Q41 5 41 8 V40 Q41 43 38 43 H10 Q7 43 7 40 Z", fill: "surface" },
    { kind: "line", x1: 7, y1: 15, x2: 41, y2: 15 },
    { kind: "circle", cx: 14, cy: 10, r: 2, fill: "accent" },
    { kind: "circle", cx: 21, cy: 10, r: 2, fill: "ink" },
    { kind: "path", d: "M13 22 Q24 17 35 22 V36 H13 Z", fill: "accent" },
  ],
  rest: [
    { kind: "path", d: "M8 33 Q10 16 24 16 Q38 16 40 33 Z", fill: "surface" },
    { kind: "line", x1: 6, y1: 34, x2: 42, y2: 34 },
    { kind: "circle", cx: 24, cy: 12, r: 3, fill: "accent" },
    { kind: "line", x1: 13, y1: 39, x2: 35, y2: 39 },
  ],
  drain: [
    { kind: "path", d: "M7 18 Q9 37 24 39 Q39 37 41 18 Z", fill: "surface" },
    { kind: "circle", cx: 17, cy: 25, r: 2, fill: "accent" },
    { kind: "circle", cx: 25, cy: 29, r: 2, fill: "accent" },
    { kind: "circle", cx: 33, cy: 24, r: 2, fill: "accent" },
    { kind: "line", x1: 17, y1: 40, x2: 15, y2: 45 },
    { kind: "line", x1: 31, y1: 40, x2: 33, y2: 45 },
  ],
  assemble: [
    { kind: "path", d: "M7 32 L24 24 L41 32 L24 40 Z", fill: "ink" },
    { kind: "path", d: "M7 23 L24 15 L41 23 L24 31 Z", fill: "accent" },
    { kind: "path", d: "M7 14 L24 6 L41 14 L24 22 Z", fill: "surface" },
  ],
  plate: [
    { kind: "circle", cx: 24, cy: 24, r: 19, fill: "surface" },
    { kind: "circle", cx: 24, cy: 24, r: 12, fill: "ink" },
    { kind: "path", d: "M18 26 Q24 15 31 25 Q26 33 18 26 Z", fill: "accent" },
  ],
  other: [
    { kind: "path", d: "M10 6 Q10 4 13 4 H31 L38 11 V42 Q38 44 35 44 H13 Q10 44 10 41 Z", fill: "surface" },
    { kind: "path", d: "M31 4 V12 H38 Z", fill: "accent" },
    { kind: "line", x1: 16, y1: 20, x2: 32, y2: 20 },
    { kind: "line", x1: 16, y1: 27, x2: 32, y2: 27 },
    { kind: "line", x1: 16, y1: 34, x2: 27, y2: 34 },
  ],
} as const satisfies Record<
  RecipeActionType,
  readonly RecipeVectorPrimitive[]
>;

export function getRecipeActionIllustration(
  actionType: unknown,
): readonly RecipeVectorPrimitive[] {
  return isActionType(actionType)
    ? RECIPE_ACTION_ILLUSTRATIONS[actionType]
    : RECIPE_ACTION_ILLUSTRATIONS.other;
}

type RecipeStepOverrides = Partial<Omit<CanonicalRecipeStep, "id">>;
type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

const DEFAULT_DURATION_SECONDS = 300;

function createUuid(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function canonicalDuration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(86_400, Math.ceil(value))
    : DEFAULT_DURATION_SECONDS;
}

function isDurationSource(value: unknown): value is RecipeDurationSource {
  return (
    value === "stated" ||
    value === "estimated" ||
    value === "user" ||
    value === "fallback"
  );
}

function isAttentionType(value: unknown): value is RecipeAttentionType {
  return value === "hands_on" || value === "passive";
}

function isActionType(value: unknown): value is RecipeActionType {
  return (RECIPE_ACTION_TYPES as readonly unknown[]).includes(value);
}

export function createRecipeStep(
  overrides: RecipeStepOverrides = {},
): CanonicalRecipeStep {
  const step: CanonicalRecipeStep = {
    text: typeof overrides.text === "string" ? overrides.text : "",
    duration_seconds: canonicalDuration(overrides.duration_seconds),
    duration_source: isDurationSource(overrides.duration_source)
      ? overrides.duration_source
      : "fallback",
    attention_type: isAttentionType(overrides.attention_type)
      ? overrides.attention_type
      : "hands_on",
    action_type: isActionType(overrides.action_type)
      ? overrides.action_type
      : "other",
    id: createUuid(),
  };
  if (typeof overrides.image_url === "string" || overrides.image_url === null) {
    step.image_url = overrides.image_url;
  }
  return step;
}

function formatApproximateDuration(seconds: number, t: Translate): string {
  if (seconds < 60) {
    return t("recipe.tutorial.duration.aboutSeconds", {
      seconds: Math.ceil(seconds),
    });
  }
  const minutes = Math.ceil(seconds / 60);
  if (seconds < 3_600) {
    return t("recipe.tutorial.duration.aboutMinutes", { minutes });
  }
  return t("recipe.tutorial.duration.aboutHoursMinutes", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

export function formatRecipeStepMetadata(
  step: Partial<RecipeStep> | null | undefined,
  t: Translate,
): string {
  const seconds = canonicalDuration(step?.duration_seconds);
  const durationSource = isDurationSource(step?.duration_source)
    ? step.duration_source
    : "fallback";
  const attentionType = isAttentionType(step?.attention_type)
    ? step.attention_type
    : "hands_on";
  return [
    formatApproximateDuration(seconds, t),
    t(RECIPE_DURATION_SOURCE_MESSAGE_KEYS[durationSource]),
    t(RECIPE_ATTENTION_TYPE_MESSAGE_KEYS[attentionType]),
  ].join(" · ");
}
