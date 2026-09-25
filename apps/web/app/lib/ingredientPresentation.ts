import type { IngredientItem } from "../types";

export interface IngredientPresentation {
  amount: string;
  preparation: string[];
  alternatives: string[];
  metricAmount: string | null;
  originalQuantity: string;
}

const NUMBER = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]|[一二两兩三四五六七八九十百半]+|one|two|three|four|five|six|half|a|an)`;
const QUALIFIER = String.raw`(?:(?:approximately|approx\.?|about|roughly|大约|大約|约|約|满满|滿滿|~|≈)\s*)?`;
const UNIT = String.raw`(?:tablespoons?|teaspoons?|tbsp|tsp|cups?|cloves?|pieces?|slices?|cans?|blocks?|bunch(?:es)?|pinches?|handfuls?|packs?|ounces?|pounds?|fl\.?\s*oz|oz|lbs?|kilograms?|grams?|milliliters?|liters?|kg|ml|g|l|汤匙|湯匙|茶匙|汤勺|湯勺|茶勺|千克|公斤|毫升|斤|两|兩|克|升|杯|个|個|块|塊|勺|片|瓣|把|根|条|條|袋|盒|罐|颗|顆|粒|碗)(?![a-z])`;
const MEASURE = new RegExp(`${QUALIFIER}${NUMBER}(?:\\s*(?:–|—|-|to|至|到)\\s*${NUMBER})?\\s*(?:(?:small|large|medium|heaping|heaped|level|scant|大|小|满|滿)\\s*)?${UNIT}(?:半)?`, "i");
const VAGUE = /^(?:to taste|as needed|a little|some|适口量|適口量|适量|適量|少许|少許|若干)/i;
const PREPARATION = /\b(?:cut|chopped|diced|sliced|minced|peeled|drained|washed|divided|thinly|finely)\b|切|剁|削|去皮|洗|沥|瀝|捞|撈/i;
const METRIC = /(?:kg|g|ml|l|kilograms?|grams?|milliliters?|liters?|千克|公斤|克|毫升|升)$/i;
const ADDITIONAL_USE = /^(?:plus\b|another\b|additional\b|另|再加)/i;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^[,，;；:：\s]+|[,，;；:：\s]+$/g, "");
}

function comparisonKey(text: string): string {
  return text.replace(/\s+/g, "").toLocaleLowerCase();
}

function appendUnique(list: string[], text: string): void {
  const value = clean(text);
  if (value && !/^[.。]+$/.test(value) && !list.some(item => comparisonKey(item) === comparisonKey(value))) list.push(value);
}

function withoutIngredientName(text: string, name: string): string {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return clean(escaped ? text.replace(new RegExp(escaped, "gi"), "") : text);
}

function quantityParts(quantity: string): string[] {
  const parenthetical: string[] = [];
  const main = quantity.replace(/\(([^()]*)\)|（([^（）]*)）/g, (_, latin: string, chinese: string) => {
    parenthetical.push(latin ?? chinese);
    return " ";
  });
  // Keep fractions intact; a slash following a unit can separate alternatives.
  return [main, ...parenthetical].flatMap(part => part
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")
    .split(/[,，;；\n]+|(?<=[a-z\u4e00-\u9fff])\s*\/\s*|\s+\/\s+/i)
    .map(clean).filter(Boolean));
}

/** Derive display-only parts; never update the ingredient or convert its units. */
export function presentIngredient(ingredient: IngredientItem): IngredientPresentation {
  const originalQuantity = ingredient.quantity ?? "";
  const preparation: string[] = [];
  const alternatives: string[] = [];
  let amount = "";
  let metricAmount = clean(ingredient.metric_quantity ?? "") || null;
  for (const part of quantityParts(originalQuantity)) {
    // An extra allocation is not an interchangeable measurement. Keep it visible.
    if (ADDITIONAL_USE.test(part)) {
      appendUnique(preparation, part);
      continue;
    }
    const match = MEASURE.exec(part) ?? VAGUE.exec(part);
    if (!match) {
      if (!amount && !PREPARATION.test(part)) amount = part;
      else appendUnique(preparation, part);
      continue;
    }
    // Never silently reduce an additive quantity to only its first component.
    if (/[+＋]/.test(part)) {
      if (!amount) amount = part;
      else appendUnique(preparation, part);
      continue;
    }
    const measured = clean(match[0]);
    const remainder = withoutIngredientName(part.slice(0, match.index) + " " + part.slice(match.index + match[0].length), ingredient.name);
    if (!amount) {
      amount = measured;
      appendUnique(preparation, remainder);
    } else if (/\bfor\b|用于|用於|用来|用來/.test(remainder)) {
      appendUnique(preparation, part);
    } else {
      if (METRIC.test(measured) && !metricAmount) metricAmount = measured;
      else if (comparisonKey(measured) !== comparisonKey(amount) && comparisonKey(measured) !== comparisonKey(metricAmount ?? "")) appendUnique(alternatives, measured);
      appendUnique(preparation, remainder);
    }
  }
  if (!amount && metricAmount) amount = metricAmount;
  if (metricAmount && comparisonKey(metricAmount) === comparisonKey(amount)) metricAmount = null;
  appendUnique(preparation, ingredient.notes ?? "");
  return {
    amount, preparation, alternatives, metricAmount, originalQuantity,
  };
}
