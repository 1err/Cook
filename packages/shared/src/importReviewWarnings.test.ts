import { expect, test } from "vitest";
import { getVisibleImportWarnings } from "./importReviewWarnings";

const internalDiagnostics = [
  "Garlic is prepared but no later use is explained; check the source.",
  "小葱头 is prepared but no later use is explained; check the source.",
  "A cooking time was not stated in the cited source; its timer was cleared.",
  "Some instruction wording is not clearly supported by its quoted actions; review the method.",
  "The completeness check omitted or changed previously identified source actions.",
  "The completeness check returned no usable repair; the initial method was retained for review.",
  "The tutorial completeness check could not finish. Review the method against the source.",
  "The completeness check found unresolved missing cooking actions.",
  "The completeness check found unsupported instructions; verify the method.",
  "The cooking sequence still needs review against the source.",
  "Source timestamps were corrected to match the actual caption segment.",
  "This source excerpt appears in multiple caption segments; review its location.",
  "Unverified source timestamps were removed; this text has no matching caption segment.",
  "Some cooking action evidence was invalid.",
  "Some cooking actions had missing or duplicate references.",
  "Some cooking actions could not be matched to the source evidence.",
  "An ingredient name or list does not support a cooking instruction.",
  "Some action evidence does not clearly support the claimed procedure; review the source.",
  "The action inventory order does not match the source evidence sequence.",
  "Some steps refer to missing source evidence.",
  "Some instructions could not be verified against source evidence.",
  "The tutorial is missing one or more cooking actions from the source.",
  "The tutorial order does not match the source action sequence.",
  "The tutorial repeats a source action; check for duplicate recap steps.",
  "The cooking action inventory is missing; check the tutorial for omitted actions.",
  "Completeness verdict: needs_review.",
  "Tutorial audit unavailable; review the method.",
  "The original method was retained because the repair was unavailable.",
];

test.each(internalDiagnostics)("hides a known internal diagnostic: %s", warning => {
  expect(getVisibleImportWarnings([warning])).toEqual([]);
  expect(getVisibleImportWarnings([`  ${warning.toUpperCase().replaceAll(" ", "  \n")}  `])).toEqual([]);
});

test("preserves actual missing data, source access issues, specifics, and unknown warnings", () => {
  const useful = [
    "The source did not provide a usable cooking method. Add the missing steps before cooking.",
    "The source did not provide a complete cooking method. Add instructions or analyze the video before cooking.",
    "Cooking method missing. Add the missing steps before cooking.",
    "The completeness check found no usable cooking method. Add instructions before cooking.",
    "The completeness check found that the amount of salt is not specified.",
    "The tutorial audit found an unclear oven temperature; check it before baking.",
    "The tutorial audit could not access the private video. Upload the video or paste recipe text.",
    "The amount of salt is not specified.",
    "The oven temperature is missing; check the source before baking.",
    "Captions were unavailable; the recipe was read from the video description.",
    "This source requires sign-in. Upload the video or paste recipe text.",
    "Finishing steps could not be verified.",
    "原视频没有说明盐的用量。",
  ];
  expect(getVisibleImportWarnings([...internalDiagnostics, ...useful])).toEqual(useful);
});

test("normalizes whitespace, deduplicates without changing order or raw diagnostics", () => {
  const raw = Object.freeze(["  Check   the heat. ", "check the heat.", "\n Steps\tmissing. ", internalDiagnostics[0], ""]);
  expect(getVisibleImportWarnings(raw)).toEqual(["Check the heat.", "Steps missing."]);
  expect(raw[0]).toBe("  Check   the heat. ");
  expect(getVisibleImportWarnings(null)).toEqual([]);
  expect(getVisibleImportWarnings(undefined)).toEqual([]);
});
