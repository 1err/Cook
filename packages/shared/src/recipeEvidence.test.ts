import { describe, expect, test } from "vitest";
import { createRecipeStep, editRecipeStepText as editStep, formatRecipeStepMetadata, recipeSourceMomentUrl } from "./recipeTutorial";
import { MESSAGE_MAP } from "./i18n";

const editRecipeStepText = (step: Parameters<typeof editStep>[0], text: string) => editStep(step, text, true);

describe("recipe evidence and timing", () => {
  test("blank placeholders have no timer and existing fallback times remain", () => {
    expect(createRecipeStep()).toMatchObject({ duration_seconds: null, duration_source: "unknown" });
    expect(createRecipeStep({ duration_seconds: 300, duration_source: "fallback" })).toMatchObject({ duration_seconds: 300, duration_source: "fallback" });
    expect(formatRecipeStepMetadata({ text: "Stir", duration_seconds: null }, key => MESSAGE_MAP.en[key] || key)).toBe("Time not specified · Hands-on");
  });
  test("instruction edits replace stale timing with an estimate while clearing evidence", () => {
    const source = { text: "Simmer", duration_seconds: 60, duration_source: "stated" as const, instruction_source: "source" as const, source_start_seconds: 10, source_end_seconds: 12, source_excerpt: "Simmer a minute" };
    expect(editRecipeStepText(source, "Stir")).toMatchObject({ text: "Stir", instruction_source: "user", duration_seconds: 60, duration_source: "estimated", source_start_seconds: null, source_end_seconds: null, source_excerpt: null });
    expect(editRecipeStepText({ ...source, duration_source: "user" }, "Stir")).toMatchObject({ duration_seconds: 60, duration_source: "user" });
  });
  test.each([
    ["Transfer the fried tofu to the braising pot.", 30],
    ["Carefully move the braised eggplant to a plate.", 30],
    ["把煎好的豆腐转入砂锅。", 30],
    ["将焖好的茄子盛入盘中。", 30],
    ["Garnish the braised tofu with scallions.", 15],
    ["Sprinkle scallions over the fried tofu.", 15],
    ["在红烧茄子上撒上葱花。", 15],
    ["最后在煎好的豆腐上点缀香菜。", 15],
    ["Turn off the heat under the braising pot.", 15],
    ["Add garlic over low heat.", 30],
    ["Remove the pan from the heat.", 15],
    ["Turn the heat off.", 15],
    ["Switch the burner off.", 15],
    ["关火，撒上葱花。", 15],
  ])("gives short actions a useful estimate without timing cooked ingredient mentions: %s", (text, seconds) => {
    const step = editRecipeStepText({ text: "Simmer", duration_seconds: 600, duration_source: "stated" }, text);
    expect(step).toMatchObject({ duration_seconds: seconds, duration_source: "estimated", instruction_source: "user" });
    expect(step.source_start_seconds).toBeNull();
    expect(step.source_excerpt).toBeNull();
  });
  test.each([
    "Transfer tofu to the pot and simmer until tender.",
    "Sprinkle in salt, then braise the eggplant.",
    "Add garlic over low heat, then simmer until tender.",
    "把豆腐转入砂锅，再焖至入味。",
    "撒上盐后继续炖煮。",
  ])("does not turn a combined cooking instruction into a short transfer timer: %s", text => {
    const step = editRecipeStepText({ text: "Old step" }, text);
    expect(step.duration_source).toBe("estimated");
    expect(step.duration_seconds).toBeGreaterThanOrEqual(300);
  });
  test.each(["Heat a pan, then add oil.", "Preheat the oven.", "Warm the oil before adding garlic."])("keeps actual preheating longer than a handling action: %s", text => {
    expect(editRecipeStepText({ text: "Old step" }, text)).toMatchObject({ duration_seconds: 120, duration_source: "estimated" });
  });
  test.each(["Chop the onion.", "将洋葱切丁。", "Whisk the sauce.", "搅拌均匀。", "Check the texture."])("gives every nonblank edit an estimate: %s", text => {
    const edited = editRecipeStepText({ text: "Old step", duration_source: "unknown", duration_seconds: null }, text);
    expect(edited.duration_source).toBe("estimated");
    expect(edited.duration_seconds).toBeGreaterThan(0);
    expect(edited.duration_seconds).toBeLessThanOrEqual(300);
  });
  test("re-estimates after another edit without retaining the earlier estimate", () => {
    const cooking = editRecipeStepText({ id: "unchanged", text: "Old step", image_url: "photo.jpg" }, "Simmer until tender.");
    const garnish = editRecipeStepText(cooking, "Garnish with scallions.");
    expect(cooking.duration_seconds).toBeGreaterThanOrEqual(300);
    expect(garnish).toMatchObject({ id: "unchanged", image_url: "photo.jpg", duration_seconds: 15, duration_source: "estimated" });
  });
  test("keeps explicitly user-set time while still removing obsolete source evidence", () => {
    const original = { text: "Simmer", duration_seconds: 43, duration_source: "user" as const, instruction_source: "source" as const, source_start_seconds: 7, source_end_seconds: 10, source_excerpt: "Simmer" };
    expect(editRecipeStepText(original, "Garnish with scallions.")).toMatchObject({ duration_seconds: 43, duration_source: "user", instruction_source: "user", source_start_seconds: null, source_end_seconds: null, source_excerpt: null });
    expect(original.source_excerpt).toBe("Simmer");
  });
  test("leaves cleared instructions untimed", () => {
    expect(editRecipeStepText({ text: "Simmer", duration_seconds: 600, duration_source: "estimated" }, "  ")).toMatchObject({ duration_seconds: null, duration_source: "unknown" });
  });
  test("legacy step creation stays optional while imported text edits can opt into estimates", () => {
    expect(createRecipeStep({ text: "Garnish the braised tofu." })).toMatchObject({ duration_seconds: null, duration_source: "unknown" });
    expect(editStep({ text: "Old" }, "Simmer gently")).toMatchObject({ duration_seconds: null, duration_source: "unknown" });
    expect(createRecipeStep({ text: "Transfer tofu to a bowl.", duration_seconds: 75, duration_source: "user" })).toMatchObject({ duration_seconds: 75, duration_source: "user" });
    expect(createRecipeStep({ text: "Legacy time", duration_seconds: 300, duration_source: "fallback" })).toMatchObject({ duration_seconds: 300, duration_source: "fallback" });
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
