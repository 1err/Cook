// Presentation only: retain the full import_review warnings on the recipe for
// quality checks and diagnosis. Unknown or specific customer notices stay visible.
const INTERNAL_DIAGNOSTICS: readonly RegExp[] = [
  /^.+\s+is prepared but no later use is explained\b/i,
  /^(?:a |the )?(?:cooking |step )?time was not stated in (?:the )?(?:cited |quoted )?source\b.*\b(?:timer|duration) was (?:cleared|removed)\b/i,
  /^(?:some |the )?instruction wording is not clearly supported by (?:its |the )?quoted actions\b/i,
  // Match boilerplate verdicts, not every message that mentions the checker:
  // an audit can also report a specific missing amount or inaccessible video.
  /^(?:the )?(?:(?:tutorial|recipe|method|internal) )?(?:(?:completeness|quality|grounding|evidence) )?(?:check(?:er)?|audit|verdict)(?: (?:verdict|result|repair|audit))?\s*:?\s*(?:(?:was |is )?(?:unavailable|not available|incomplete|needs_review|ready)|could not (?:finish|complete)|did not (?:finish|complete)|timed out|failed|omitted or changed previously identified source actions|returned no usable repair|found unresolved missing cooking actions|found unsupported instructions)\b/i,
  /^(?:the )?(?:initial|original) (?:method|draft|tutorial) (?:was )?retained\b.*\b(?:repair|audit|check)\b/i,
  /^the cooking sequence still needs review against the source\b/i,
  /^source timestamps were corrected to match the actual caption segment\b/i,
  /^this source excerpt appears in multiple caption segments\b/i,
  /^unverified source timestamps were removed\b/i,
  /^some cooking action evidence was invalid\b/i,
  /^some cooking actions had missing or duplicate references\b/i,
  /^some cooking actions could not be matched to the source evidence\b/i,
  /^an ingredient name or list does not support a cooking instruction\b/i,
  /^some action evidence does not clearly support the claimed procedure\b/i,
  /^the action inventory order does not match the source evidence sequence\b/i,
  /^some steps refer to missing source evidence\b/i,
  /^some instructions could not be verified against source evidence\b/i,
  /^the tutorial is missing one or more cooking actions from the source\b/i,
  /^the tutorial order does not match the source action sequence\b/i,
  /^the tutorial repeats a source action\b/i,
  /^the cooking action inventory is missing\b/i,
];

// A genuinely missing method remains actionable, even if a checker prefixes it.
const MISSING_METHOD = /\b(?:no|missing|without) (?:usable |complete )?(?:cooking )?(?:method|steps|instructions)\b|\b(?:cooking method|cooking steps) (?:is |are )?missing\b|\b(?:did not|does not|didn't) provide (?:a |any )?(?:usable |complete )?(?:cooking )?(?:method|steps|instructions)\b/i;

export function getVisibleImportWarnings(warnings?: readonly string[] | null): string[] {
  const seen = new Set<string>();
  const visible: string[] = [];
  for (const raw of warnings ?? []) {
    const warning = raw.trim().replace(/\s+/g, " ");
    const key = warning.toLocaleLowerCase();
    if (!warning || seen.has(key)) continue;
    seen.add(key);
    if (!MISSING_METHOD.test(warning) && INTERNAL_DIAGNOSTICS.some(pattern => pattern.test(warning))) continue;
    visible.push(warning);
  }
  return visible;
}
