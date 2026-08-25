import { describe, expect, test } from "vitest";

import {
  MESSAGE_MAP,
  RECIPE_ACTION_ILLUSTRATIONS,
  RECIPE_ACTION_MESSAGE_KEYS,
  RECIPE_ACTION_TYPES,
  RECIPE_ATTENTION_TYPE_MESSAGE_KEYS,
  RECIPE_DURATION_SOURCE_MESSAGE_KEYS,
  createRecipeStep,
  formatRecipeStepMetadata,
  getRecipeActionIllustration,
} from "@cooking/shared";

const translateEnglish = (
  key: string,
  vars?: Record<string, string | number>,
): string => {
  const template = MESSAGE_MAP.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars?.[name] ?? ""),
  );
};

describe("recipe tutorial contract", () => {
  test("provides one distinct renderer-neutral illustration for every action", () => {
    expect(RECIPE_ACTION_TYPES).toEqual([
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
    ]);
    expect(Object.keys(RECIPE_ACTION_ILLUSTRATIONS).sort()).toEqual(
      [...RECIPE_ACTION_TYPES].sort(),
    );

    const serialized = RECIPE_ACTION_TYPES.map((action) => {
      const primitives = RECIPE_ACTION_ILLUSTRATIONS[action];
      expect(primitives.length).toBeGreaterThan(0);
      for (const primitive of primitives) {
        expect(["path", "circle", "line"]).toContain(primitive.kind);
        if ("fill" in primitive && primitive.fill !== undefined) {
          expect(["accent", "ink", "surface"]).toContain(primitive.fill);
        }
      }
      return JSON.stringify(primitives);
    });

    expect(new Set(serialized).size).toBe(RECIPE_ACTION_TYPES.length);
  });

  test("creates fresh canonical steps with transparent defaults", () => {
    const first = createRecipeStep();
    const second = createRecipeStep();

    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(second.id).not.toBe(first.id);
    expect(first).toEqual({
      id: first.id,
      text: "",
      duration_seconds: 300,
      duration_source: "fallback",
      attention_type: "hands_on",
      action_type: "other",
    });
  });

  test("formats canonical duration, provenance, and attention metadata", () => {
    const step = createRecipeStep({
      text: "Simmer until tender",
      duration_seconds: 480,
      duration_source: "estimated",
      attention_type: "passive",
      action_type: "simmer",
    });

    expect(formatRecipeStepMetadata(step, translateEnglish)).toBe(
      "About 8 min · AI estimated · Passive",
    );
  });

  test.each([
    [45, "About 45 sec"],
    [61, "About 2 min"],
    [3_599, "About 60 min"],
    [3_661, "About 1 hr 2 min"],
  ])("formats %i seconds with the right approximate unit", (seconds, label) => {
    const step = createRecipeStep({ duration_seconds: seconds });
    expect(formatRecipeStepMetadata(step, translateEnglish).split(" · ")[0]).toBe(
      label,
    );
  });

  test("uses transparent labels for legacy steps with missing metadata", () => {
    expect(
      formatRecipeStepMetadata({ text: "Legacy instruction" }, translateEnglish),
    ).toBe("About 5 min · Rough estimate · Hands-on");
  });

  test("uses the neutral pictogram for legacy or unknown action values", () => {
    expect(getRecipeActionIllustration(undefined)).toBe(
      RECIPE_ACTION_ILLUSTRATIONS.other,
    );
    expect(getRecipeActionIllustration("legacy-action")).toBe(
      RECIPE_ACTION_ILLUSTRATIONS.other,
    );
    expect(getRecipeActionIllustration("chop")).toBe(
      RECIPE_ACTION_ILLUSTRATIONS.chop,
    );
  });

  test("English and Chinese messages cover every tutorial label map", () => {
    const mappedKeys = [
      ...Object.values(RECIPE_ACTION_MESSAGE_KEYS),
      ...Object.values(RECIPE_DURATION_SOURCE_MESSAGE_KEYS),
      ...Object.values(RECIPE_ATTENTION_TYPE_MESSAGE_KEYS),
    ];
    const editorKeys = [
      "recipe.tutorial.duration.aboutSeconds",
      "recipe.tutorial.duration.aboutMinutes",
      "recipe.tutorial.duration.aboutHoursMinutes",
      "recipe.tutorial.editor.duration",
      "recipe.tutorial.editor.attention",
      "recipe.tutorial.editor.illustration",
      "recipe.tutorial.editor.estimate",
      "recipe.tutorial.editor.estimating",
      "recipe.tutorial.editor.estimateError",
      "recipe.tutorial.edit",
      "recipe.tutorial.save",
      "recipe.tutorial.cancel",
      "recipe.tutorial.noSteps",
    ];

    for (const key of [...mappedKeys, ...editorKeys]) {
      expect(MESSAGE_MAP.en[key], `missing English message: ${key}`).toBeTruthy();
      expect(MESSAGE_MAP.zh[key], `missing Chinese message: ${key}`).toBeTruthy();
    }
  });
});
