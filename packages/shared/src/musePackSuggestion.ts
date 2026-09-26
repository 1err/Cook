import type { MuseCartItem } from "./museShopping";

export type MusePackSuggestion =
  | { status: "suggested"; packs: number; requiredAmount: string; packageAmount: string; totalAmount: string; leftoverAmount: string; approximate?: true }
  | { status: "starter"; packs: 1; reason: "package-size" | "ingredient-amount" | "unit-mismatch" }
  | { status: "unavailable"; reason: "package-size" | "ingredient-amount" | "unit-mismatch" | "too-many-packs" | "already-added" };

type Dimension = "mass" | "volume" | "item" | "bag" | "bottle" | "can" | "jar" | "pack" | "block" | "bunch" | "clove" | "bulb" | "stalk";
type Amount = { dimension: Dimension; value: number };
type Measurement = Amount & { start: number; end: number; unitScale: number };
const NUMBER = "(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?|\\.\\d+)";
const UNIT = "fl\\.?\\s*oz\\.?|fluid\\s+ounces?|kilograms?|kgs?|grams?|g|ounces?|oz|pounds?|lbs?|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|tablespoons?|tbsp|tbs|teaspoons?|tsp|cups?|dozen|counts?|ct|pieces?|pcs?|each|whole|eggs?|bags?|bottles?|cans?|jars?|packs?|blocks?|bunch(?:es)?|cloves?|bulbs?|stalks?|千克|公斤|克|磅|盎司|毫升|升|个|枚|只|颗|袋|瓶|罐|包|块|把|瓣|头|根";
const UNITS: Record<string, [Dimension, number]> = {};
function units(names: string[], dimension: Dimension, factor: number) {
  for (const name of names) UNITS[name] = [dimension, factor];
}
units(["g", "gram", "grams", "克"], "mass", 1);
units(["kg", "kgs", "kilogram", "kilograms", "千克", "公斤"], "mass", 1000);
units(["oz", "ounce", "ounces", "盎司"], "mass", 28.349523125);
units(["lb", "lbs", "pound", "pounds", "磅"], "mass", 453.59237);
units(["ml", "milliliter", "milliliters", "millilitre", "millilitres", "毫升"], "volume", 1);
units(["l", "liter", "liters", "litre", "litres", "升"], "volume", 1000);
// US customary culinary volumes; never infer a mass/volume density.
units(["floz", "fluidounce", "fluidounces"], "volume", 29.5735295625);
units(["cup", "cups"], "volume", 236.5882365);
units(["tbsp", "tbs", "tablespoon", "tablespoons"], "volume", 14.78676478125);
units(["tsp", "teaspoon", "teaspoons"], "volume", 4.92892159375);
units(["count", "counts", "ct", "piece", "pieces", "pc", "pcs", "each", "whole", "egg", "eggs", "个", "枚", "只", "颗"], "item", 1);
units(["dozen"], "item", 12);
for (const dimension of ["bag", "bottle", "can", "jar", "pack", "block", "clove", "bulb", "stalk"] as const) units([dimension, `${dimension}s`], dimension, 1);
units(["bunch", "bunches"], "bunch", 1);
units(["袋"], "bag", 1);
units(["瓶"], "bottle", 1);
units(["罐"], "can", 1);
units(["包"], "pack", 1);
units(["块"], "block", 1);
units(["把"], "bunch", 1);
units(["瓣"], "clove", 1);
units(["头"], "bulb", 1);
units(["根"], "stalk", 1);

function normalize(text: string): string {
  const fractions: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8" };
  return text.toLowerCase()
    .replace(/[½¼¾⅓⅔⅛⅜⅝⅞]/g, (character) => ` ${fractions[character]}`)
    .replace(/（/g, "(").replace(/）/g, ")").replace(/，/g, ",").replace(/；/g, ";")
    .trim();
}

function numeric(text: string): number {
  const fraction = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  const value = fraction ? Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]) : Number(text);
  return Number.isFinite(value) && value > 0 ? value : NaN;
}

function uncertain(text: string): boolean {
  return text.length > 1000 || /[~～≈+约]|左右|估计|平均|\b(?:about|approx(?:imately)?|around|avg|average|estimated|or|to)\b/.test(text)
    || /\d[\d.\s/a-z磅盎司]*[-–—至到]\s*\d|(?:^|\s)-\s*\d/.test(text);
}

function measurements(text: string): Measurement[] | null {
  // Chinese fluid-ounce labels are not mass aliases; their regional volume is unspecified.
  if (/液\s*(?:体|量)?\s*盎司/.test(text)) return null;
  const expression = new RegExp(`(^|[^0-9./+-])(${NUMBER})\\s*-?\\s*(${UNIT})(?![a-z])`, "g");
  const results: Measurement[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text))) {
    const unit = UNITS[match[3].replace(/[.\s]/g, "")];
    const value = numeric(match[2]) * unit[1];
    if (!Number.isFinite(value) || value <= 0 || (unit[0] !== "mass" && unit[0] !== "volume" && !Number.isInteger(value))) return null;
    const start = match.index + match[1].length;
    const end = expression.lastIndex;
    if (/^\s*(?:protein|fat|sugar|carbs|carbohydrates|sodium|fiber|fibre|per\s+serving|each\s+serving|\/\s*serving)\b/.test(text.slice(end))) return null;
    if (/(?:每份|每餐|营养|\b(?:protein|fat|sugar|carbs|carbohydrates|sodium|fiber|fibre))\s*[:=]?\s*$/.test(text.slice(0, start))) return null;
    results.push({ dimension: unit[0], value, start, end, unitScale: unit[1] });
    expression.lastIndex = end - 1;
  }
  return results;
}

function equivalentAmount(values: Array<Amount & { unitScale: number }>, conservative: "min" | "max"): Amount | null {
  if (!values.length || values.some((amount) => amount.dimension !== values[0].dimension)) return null;
  const min = Math.min(...values.map((amount) => amount.value));
  const max = Math.max(...values.map((amount) => amount.value));
  if (values[0].dimension !== "mass" && values[0].dimension !== "volume" && min !== max) return null;
  if (values.some((amount, index) => values.slice(index + 1).some((other) => amount.unitScale === other.unitScale && Math.abs(amount.value - other.value) > 1e-9))) return null;
  // Small differences on dual metric/imperial labels are rounding, not extra contents.
  if (max - min > max * 0.01) return null;
  return { dimension: values[0].dimension, value: conservative === "min" ? min : max };
}

type PreparedAmount = { text: string; approximate: boolean; invalid: boolean; unsupported?: boolean };

function invalidQuantity(text: string): boolean {
  if (/\b(?:nan|infinity)(?=$|[^a-z]|(?:kg|g|ml|l|oz|lb)\b)|∞/i.test(text)
    || /\d(?:\.\d*){2,}|\d(?:[\d.]*)e[+-]?\d|\b0x[\da-f]/i.test(text)
    || /\d\s*\/\s*\d+\s*\/|\d+\s*\/\s*\d+\.\d|\d+\.\d+\s*\//.test(text)
    || /\d\s*,\s*\d/.test(text.replace(/\bpack\s+of\s+\d+\s*,/g, ""))
    || new RegExp(`[-−]\\s*${NUMBER}\\s*(?:${UNIT}|[x×]|$)`, "i").test(text)
    || /(?:^|[^0-9])0(?:\.0+)?\s*[x×]/.test(text)) return true;
  if (new RegExp(`^${NUMBER}$`).test(text.trim()) && !Number.isFinite(numeric(text))) return true;
  const expression = new RegExp(`(^|[^0-9./+-])(${NUMBER})\\s*-?\\s*(${UNIT})(?![a-z])`, "g");
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text))) {
    if (!Number.isFinite(numeric(match[2]))) return true;
    expression.lastIndex -= 1;
  }
  return false;
}

// Preserve the estimate flag while selecting explicit nominal values or a cautious
// range endpoint: upper demand, lower purchasable package contents.
function prepareAmount(raw: string, bound: "min" | "max"): PreparedAmount {
  let text = normalize(raw);
  let approximate = false;
  let invalid = false;
  let unresolvedRange = false;
  if (text.length > 1000) return { text, approximate, invalid };
  text = text.replace(/(^|[^\d.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?![\d.,])/g,
    (match, prefix: string, number: string, offset: number, input: string) => /\bpack\s+of\s*$/.test(input.slice(0, offset + prefix.length))
      ? match
      : prefix + number.replace(/,/g, ""));
  const range = new RegExp(`(^|[^0-9./+\\-])(${NUMBER})\\s*(${UNIT})?\\s*(?:[-–—~～至到]|\\bto\\b)\\s*(${NUMBER})\\s*(${UNIT})?(?![a-z0-9./])`, "g");
  text = text.replace(range, (original, prefix: string, low: string, lowUnit: string | undefined, high: string, highUnit: string | undefined) => {
    if (!lowUnit && !highUnit) {
      unresolvedRange = true;
      return original;
    }
    const firstUnit = lowUnit ?? highUnit!;
    const secondUnit = highUnit ?? lowUnit!;
    const first = UNITS[firstUnit.replace(/[.\s]/g, "")];
    const second = UNITS[secondUnit.replace(/[.\s]/g, "")];
    const firstValue = numeric(low) * first[1];
    const secondValue = numeric(high) * second[1];
    if (!Number.isFinite(firstValue) || !Number.isFinite(secondValue)) {
      invalid = true;
      return original;
    }
    if (first[0] !== second[0]) {
      unresolvedRange = true;
      return original;
    }
    approximate = true;
    const useFirst = bound === "min" ? firstValue <= secondValue : firstValue >= secondValue;
    return `${prefix}${useFirst ? low : high} ${useFirst ? firstUnit : secondUnit}`;
  });
  if (new RegExp(`${NUMBER}\\s*(?:${UNIT})?\\s*(?:[~～≈]|大约|大概|约|左右|估计|平均|about|approx(?:imately)?|around|avg|average|estimated)\\s*${NUMBER}`).test(text)) unresolvedRange = true;
  text = text.replace(/\b(?:about|approximately|approx|around|average|avg|estimated)(?![a-z])\.?\s*|大约|大概|约|左右|估计|平均|[~～≈]/g, (marker) => {
    if (unresolvedRange) return marker;
    approximate = true;
    return " ";
  }).trim();
  return { text, approximate, invalid: invalid || invalidQuantity(text), unsupported: unresolvedRange };
}

function ingredientSegments(text: string): string[] | null {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth < 0) return null;
    } else if (depth === 0 && /[;+,]/.test(text[index])) {
      segments.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  segments.push(text.slice(start).trim());
  return depth === 0 ? segments : null;
}

function combinedIngredient(prepared: PreparedAmount): { amount: Amount | null; invalid: boolean; mismatch: boolean } {
  const segments = ingredientSegments(prepared.text);
  if (!segments) return { amount: null, invalid: prepared.invalid, mismatch: false };
  if (prepared.invalid || segments.some((segment) => invalidQuantity(segment))) return { amount: null, invalid: true, mismatch: false };
  if (prepared.unsupported) return { amount: null, invalid: false, mismatch: false };
  const amounts = segments.map(ingredientAmount);
  if (amounts.some((amount) => amount === null)) return { amount: null, invalid: false, mismatch: false };
  const valid = amounts as Amount[];
  if (valid.some((amount) => amount.dimension !== valid[0].dimension)) return { amount: null, invalid: false, mismatch: true };
  return { amount: { dimension: valid[0].dimension, value: valid.reduce((sum, amount) => sum + amount.value, 0) }, invalid: false, mismatch: false };
}

function ingredientAmount(raw: string): Amount | null {
  const text = normalize(raw);
  if (!text || uncertain(text) || text.includes(",")) return null;
  if (new RegExp(`^${NUMBER}$`).test(text)) {
    const value = numeric(text);
    return Number.isInteger(value) ? { dimension: "item", value } : null;
  }
  const found = measurements(text);
  if (!found?.length) return null;
  let remaining = text;
  for (const amount of [...found].reverse()) remaining = remaining.slice(0, amount.start) + remaining.slice(amount.end);
  if (!/^[\s(),/]*$/.test(remaining)) return null;
  return equivalentAmount(found, "max");
}

function packageAmount(raw: string, dimension: Dimension): Amount | "mismatch" | null {
  const text = normalize(raw);
  if (!text || uncertain(text) || /\bcase\s+of\s*\d|\d\s*pks?(?![a-z])|\bper\s+(?:serving|portion)\b|\bserving\s+size\b|每份/.test(text)) return null;
  const found = measurements(text);
  if (!found?.length) return null;
  const matching = found.filter((amount) => amount.dimension === dimension);
  if (!matching.length) return "mismatch";
  const packOf = /\bpack\s+of\s+(\d+)\b/.exec(text);
  const packCounts = found.filter((amount) => amount.dimension !== "mass" && amount.dimension !== "volume" && amount.dimension !== dimension);
  if (packOf) packCounts.push({ dimension: "pack", value: Number(packOf[1]), start: packOf.index, end: packOf.index + packOf[0].length, unitScale: 1 });
  const converted: Array<Amount & { unitScale: number }> = [];
  for (const amount of matching) {
    const before = text.slice(0, amount.start);
    const after = text.slice(amount.end);
    const prefix = new RegExp(`(${NUMBER})\\s*[x×]\\s*$`).exec(before);
    const suffix = new RegExp(`^\\s*[x×]\\s*(${NUMBER})(?![a-z0-9./])`).exec(after);
    let multiplier = 1;
    if (prefix || suffix) {
      if (prefix && suffix) return null;
      if (prefix && /[x×]\s*$/.test(before.slice(0, prefix.index))) return null;
      if (suffix && /^\s*[x×]/.test(after.slice(suffix[0].length))) return null;
      multiplier = numeric((prefix ?? suffix)![1]);
      if (!Number.isInteger(multiplier)) return null;
    } else if (/^\s*[x×]/.test(after)) return null;
    const perItem = /^\s*(?:each|per\s+(?:pack|bottle|can|jar|piece))\b/.test(after);
    if (packCounts.length && (perItem || packCounts.some((count) => count.dimension !== "item"))) {
      if (packCounts.length !== 1 || !perItem || multiplier !== 1) return null;
      multiplier = packCounts[0].value;
    }
    if (!Number.isInteger(multiplier) || multiplier <= 0) return null;
    converted.push({ dimension, value: amount.value * multiplier, unitScale: amount.unitScale });
  }
  return equivalentAmount(converted, "min");
}

function explicitPackageSize(raw: string): boolean {
  const text = normalize(raw);
  const found = measurements(text);
  if (!found?.length || uncertain(text)) return false;
  let remaining = text;
  for (const amount of [...found].reverse()) remaining = remaining.slice(0, amount.start) + remaining.slice(amount.end);
  remaining = remaining.replace(/\bpack\s+of\s+\d+\b/g, "")
    .replace(new RegExp(`${NUMBER}\\s*[x×]|[x×]\\s*${NUMBER}`, "g"), "")
    .replace(/\b(?:each|per\s+(?:pack|bottle|can|jar|piece))\b/g, "");
  return /^[\s(),/]*$/.test(remaining);
}

function formatAmount(value: number, dimension: Dimension, language: "en" | "zh"): string {
  const rounded = Number(Math.max(0, value).toFixed(value > 0 && value < 0.01 ? 6 : 2));
  if (dimension === "mass") return `${rounded} g`;
  if (dimension === "volume") return `${rounded} ml`;
  const chinese: Record<Exclude<Dimension, "mass" | "volume">, string> = {
    item: "个", bag: "袋", bottle: "瓶", can: "罐", jar: "罐", pack: "包", block: "块", bunch: "把", clove: "瓣", bulb: "头", stalk: "根",
  };
  const unit = language === "zh" ? chinese[dimension] : `${dimension}${rounded === 1 ? "" : dimension === "bunch" ? "es" : "s"}`;
  return `${rounded} ${unit}`;
}

export function getMusePackSuggestion(
  item: Pick<MuseCartItem, "product" | "ingredients" | "hasConfirmedMatch">,
  language: "en" | "zh" = "en",
  packageSizeOverride?: string,
): MusePackSuggestion {
  if (item.hasConfirmedMatch) return { status: "unavailable", reason: "already-added" };
  const override = packageSizeOverride?.trim();
  const preparedPackage = prepareAmount(override || item.product.name, "min");
  const preparedIngredients = item.ingredients.map((ingredient) => prepareAmount(ingredient.suggestedPurchase, "max"));
  const ingredients = preparedIngredients.map(combinedIngredient);
  const packageText = preparedPackage.text;
  const packageMeasurements = preparedPackage.unsupported ? null : measurements(packageText);
  const primaryDimension = packageMeasurements?.find((amount) => amount.dimension === "mass" || amount.dimension === "volume")?.dimension
    ?? packageMeasurements?.[0]?.dimension;
  const packageProbe = primaryDimension ? packageAmount(packageText, primaryDimension) : null;
  if (preparedPackage.invalid || (override && (!explicitPackageSize(packageText) || !packageProbe))) {
    return { status: "unavailable", reason: "package-size" };
  }
  if (ingredients.some((ingredient) => ingredient.invalid)) return { status: "unavailable", reason: "ingredient-amount" };
  if (!packageProbe) return { status: "starter", packs: 1, reason: "package-size" };
  if (ingredients.some((ingredient) => ingredient.mismatch)) return { status: "starter", packs: 1, reason: "unit-mismatch" };
  if (!ingredients.length || ingredients.some((ingredient) => ingredient.amount === null)) return { status: "starter", packs: 1, reason: "ingredient-amount" };
  const validAmounts = ingredients.map((ingredient) => ingredient.amount!) as Amount[];
  const dimension = validAmounts[0].dimension;
  if (validAmounts.some((amount) => amount.dimension !== dimension)) return { status: "starter", packs: 1, reason: "unit-mismatch" };
  const available = packageAmount(packageText, dimension);
  if (available === "mismatch") return { status: "starter", packs: 1, reason: "unit-mismatch" };
  if (!available) return override
    ? { status: "unavailable", reason: "package-size" }
    : { status: "starter", packs: 1, reason: "package-size" };
  const required = validAmounts.reduce((sum, amount) => sum + amount.value, 0);
  const packs = Math.ceil(required / available.value - 1e-10);
  if (!Number.isFinite(packs) || packs > 99) return { status: "unavailable", reason: "too-many-packs" };
  if (packs < 1) return { status: "unavailable", reason: "ingredient-amount" };
  const total = available.value * packs;
  return {
    status: "suggested", packs,
    ...(preparedPackage.approximate || preparedIngredients.some((ingredient) => ingredient.approximate) ? { approximate: true as const } : {}),
    requiredAmount: formatAmount(required, dimension, language),
    packageAmount: formatAmount(available.value, dimension, language),
    totalAmount: formatAmount(total, dimension, language),
    leftoverAmount: formatAmount(total - required, dimension, language),
  };
}
