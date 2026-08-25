"use client";

import type { ProductLookupState } from "./productLoading";
import { canonicalIngredientKey } from "./productLookupCoordinator";
import { ShoppingItemRow } from "./ShoppingItemRow";
import styles from "./ShoppingList.module.css";

export type ShoppingCategoryRow = {
  item: { name: string; suggested_purchase: string };
  origIndex: number;
};

type ShoppingCategorySectionProps = {
  title: string;
  rows: ShoppingCategoryRow[];
  checked: Set<number>;
  openProducts: Record<string, boolean>;
  lookup: Record<string, ProductLookupState>;
  menuOpenFor: number | null;
  onToggleChecked: (index: number) => void;
  onHide: (index: number) => void;
  onToggleMenu: (index: number) => void;
  onToggleProducts: (name: string) => void;
  onRetryProducts: (name: string) => void;
};

export function ShoppingCategorySection({
  title,
  rows,
  checked,
  openProducts,
  lookup,
  menuOpenFor,
  onToggleChecked,
  onHide,
  onToggleMenu,
  onToggleProducts,
  onRetryProducts,
}: ShoppingCategorySectionProps) {
  const orderedRows = [
    ...rows.filter((row) => !checked.has(row.origIndex)),
    ...rows.filter((row) => checked.has(row.origIndex)),
  ];
  const remaining = rows.filter((row) => !checked.has(row.origIndex)).length;

  return (
    <section className={styles.category}>
      <header className={styles.categoryHeader}>
        <h2 className="cw-display">{title}</h2>
        <span>{remaining} to buy</span>
      </header>
      <div>
        {orderedRows.map(({ item, origIndex }) => {
          const productKey = canonicalIngredientKey(item.name);
          return (
            <ShoppingItemRow
              key={origIndex}
              name={item.name}
              suggestedPurchase={item.suggested_purchase}
              checked={checked.has(origIndex)}
              productsOpen={Boolean(openProducts[productKey])}
              productState={lookup[productKey] ?? { status: "idle" }}
              menuOpen={menuOpenFor === origIndex}
              onToggleChecked={() => onToggleChecked(origIndex)}
              onHide={() => onHide(origIndex)}
              onToggleMenu={() => onToggleMenu(origIndex)}
              onToggleProducts={() => onToggleProducts(item.name)}
              onRetryProducts={() => onRetryProducts(item.name)}
            />
          );
        })}
      </div>
    </section>
  );
}
