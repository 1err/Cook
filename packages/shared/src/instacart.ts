export type InstacartItem = { name: string; quantity: string };

/** Select current ingredients without changing list state or Weee selections. */
export function buildInstacartItems({ originalItems, purchaseItems, hidden, checked }: {
  originalItems: readonly { name: string; total_quantity: string }[];
  purchaseItems?: readonly { name: string; suggested_purchase: string }[] | null;
  hidden?: ReadonlySet<number>;
  checked?: ReadonlySet<number>;
}): InstacartItem[] {
  const items = purchaseItems != null
    ? purchaseItems.filter((_, index) => !hidden?.has(index) && !checked?.has(index))
      .map((item) => ({ name: item.name.trim(), quantity: item.suggested_purchase.trim() }))
    : originalItems.map((item) => ({ name: item.name.trim(), quantity: item.total_quantity.trim() }));
  return items.filter((item) => item.name.length > 0);
}

export function isSafeInstacartUrl(value: string): boolean {
  if (!value || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "www.instacart.com" || url.hostname === "instacart.com")
      && !url.username && !url.password && !url.port
      && url.pathname.length > 1;
  } catch {
    return false;
  }
}
