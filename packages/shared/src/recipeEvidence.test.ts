import { describe, expect, test } from "vitest";
import { createRecipeStep, editRecipeStepText, formatRecipeStepMetadata, recipeSourceMomentUrl } from "./recipeTutorial";
import { MESSAGE_MAP } from "./i18n";

describe("recipe evidence and unknown timing", () => {
  test("new steps have no invented timer but existing fallback times remain", () => {
    expect(createRecipeStep()).toMatchObject({ duration_seconds: null, duration_source: "unknown" });
    expect(createRecipeStep({ duration_seconds: 300, duration_source: "fallback" })).toMatchObject({ duration_seconds: 300, duration_source: "fallback" });
    expect(formatRecipeStepMetadata({ text: "Stir", duration_seconds: null }, key => MESSAGE_MAP.en[key] || key)).toBe("Time not specified · Hands-on");
  });
  test("instruction edits clear evidence and stale timing while preserving explicit user timing", () => {
    const source = { text: "Simmer", duration_seconds: 60, duration_source: "stated" as const, instruction_source: "source" as const, source_start_seconds: 10, source_end_seconds: 12, source_excerpt: "Simmer a minute" };
    expect(editRecipeStepText(source, "Stir")).toMatchObject({ text: "Stir", instruction_source: "user", duration_seconds: null, duration_source: "unknown", source_start_seconds: null, source_end_seconds: null, source_excerpt: null });
    expect(editRecipeStepText({ ...source, duration_source: "user" }, "Stir")).toMatchObject({ duration_seconds: 60, duration_source: "user" });
  });
  test("builds a canonical YouTube moment without propagating URL parameters", () => {
    expect(recipeSourceMomentUrl("https://youtu.be/A6bByqI_TH8?tracking=private", 13.9)).toBe("https://www.youtube.com/watch?v=A6bByqI_TH8&t=13s");
    expect(recipeSourceMomentUrl("https://www.youtube.com/watch?v=A6bByqI_TH8", 0)).toContain("&t=0s");
  });
  test.each(["javascript:alert(1)", "https://youtube.com.evil.test/watch?v=A6bByqI_TH8", "https://evil@youtube.com/watch?v=A6bByqI_TH8", "https://youtube.com/watch?v=bad", "http://youtube.com/watch?v=A6bByqI_TH8"])("rejects unsafe or invalid source %s", url => {
    expect(recipeSourceMomentUrl(url, 10)).toBeNull();
  });
  test("requires a real nonnegative timestamp", () => {
    for (const time of [null, undefined, -1, NaN, Infinity]) expect(recipeSourceMomentUrl("https://youtu.be/A6bByqI_TH8", time)).toBeNull();
  });
});
