import type { ShoppingListItem, ShoppingSourceItem } from "./types";

export const SHOPPING_QUANTITY_VERSION = 2;

/** Preserve recipe contributions; the displayed total must not be counted again. */
export function shoppingRefineInputs(items: ShoppingListItem[]): ShoppingSourceItem[] {
  return items.flatMap((item) => {
    const sources = item.source_items;
    if (sources == null || (Array.isArray(sources) && sources.length === 0)) {
      return [{ name: item.name, quantity: item.total_quantity }];
    }
    if (!Array.isArray(sources) || sources.some((source) => !source
      || typeof source.name !== "string" || !source.name.trim()
      || typeof source.quantity !== "string")) {
      throw new Error("Invalid shopping ingredient sources");
    }
    return sources.map(({ name, quantity }) => ({ name, quantity }));
  });
}
