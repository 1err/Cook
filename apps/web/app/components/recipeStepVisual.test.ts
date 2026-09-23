import { describe, expect, it } from "vitest";
import { resolveRecipeStepVisual } from "./recipeStepVisual";

describe("resolveRecipeStepVisual", () => {
  it("preserves a known canonical action even when the text suggests another one", () => {
    expect(resolveRecipeStepVisual("bake", "切豆腐成小块")).toEqual({
      actionType: "bake",
      ingredientVariant: "tofu",
    });
  });

  it.each([
    ["将豆腐切成5毫米厚片备用", "tofu"],
    ["将茄子切成滚刀块备用", "vegetable"],
    ["切五花肉成颗粒备用", "meat"],
    ["准备红椒去籽切颗粒备用", "vegetable"],
  ] as const)("infers a chop visual for Chinese legacy text: %s", (text, ingredientVariant) => {
    expect(resolveRecipeStepVisual("other", text)).toEqual({
      actionType: "chop",
      ingredientVariant,
    });
  });

  it("infers a conservative English action when metadata is missing", () => {
    expect(resolveRecipeStepVisual(undefined, "Whisk the eggs until smooth")).toEqual({
      actionType: "mix",
      ingredientVariant: "generic",
    });
  });

  it.each([
    ["Stir-fry the pork until browned", "sear", "meat"],
    ["Fold the wrapper over the filling", "assemble", "generic"],
    ["Stir the sauce until smooth", "mix", "generic"],
  ] as const)(
    "resolves overlapping English action words: %s",
    (text, actionType, ingredientVariant) => {
      expect(resolveRecipeStepVisual("other", text)).toEqual({
        actionType,
        ingredientVariant,
      });
    },
  );

  it("uses a neutral fallback when neither metadata nor text identifies an action", () => {
    expect(resolveRecipeStepVisual(null, "Continue with the next step")).toEqual({
      actionType: "other",
      ingredientVariant: "generic",
    });
  });
});
