import type { IngredientItem } from "./types";

export function formatIngredientQuantity(item: IngredientItem): string {
  const quantity = item.quantity?.trim() ?? "";
  const metricQuantity = item.metric_quantity?.trim() ?? "";
  const notes = item.notes?.trim() ?? "";

  let base = "";
  if (quantity && metricQuantity && quantity !== metricQuantity) {
    base = `${quantity} / ${metricQuantity}`;
  } else {
    base = quantity || metricQuantity;
  }

  if (base && notes) return `${base}, ${notes}`;
  return base || notes;
}
