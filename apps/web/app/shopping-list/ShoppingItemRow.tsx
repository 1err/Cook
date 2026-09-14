"use client";

import type { ProductLookupState } from "./productLoading";
import { useT } from "../lib/i18n";
import { ProductPicks } from "./ProductPicks";
import styles from "./ShoppingList.module.css";

type ShoppingItemRowProps = {
  name: string;
  suggestedPurchase: string;
  ingredientKey: string;
  selectedUrl?: string;
  checked: boolean;
  productsOpen: boolean;
  productState: ProductLookupState;
  menuOpen: boolean;
  onToggleChecked: () => void;
  onHide: () => void;
  onToggleMenu: () => void;
  onToggleProducts: () => void;
  onRetryProducts: () => void;
  onSelect?: (productUrl: string) => void;
};

export function ShoppingItemRow({
  name,
  suggestedPurchase,
  ingredientKey,
  selectedUrl,
  checked,
  productsOpen,
  productState,
  menuOpen,
  onToggleChecked,
  onHide,
  onToggleMenu,
  onToggleProducts,
  onRetryProducts,
  onSelect,
}: ShoppingItemRowProps) {
  const t = useT();
  const productsPending = productState.status === "queued" || productState.status === "loading";

  return (
    <div className={`${styles.itemBlock} ${checked ? styles.checked : ""}`}>
      <div className={styles.itemRow}>
        <label>
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleChecked}
            aria-label={checked
              ? t("shopping.markStillNeedToBuy", { name })
              : t("shopping.markAlreadyHave", { name })}
          />
          <span>
            <strong>{name}</strong>
            {suggestedPurchase ? <small>{suggestedPurchase}</small> : null}
          </span>
        </label>
        <div className={styles.itemMenu} data-shopping-item-menu>
          <button type="button" aria-label={`${t("shopping.more")}: ${name}`} onClick={onToggleMenu}>•••</button>
          {menuOpen ? (
            <div className={styles.menuPopover}>
              <button type="button" onClick={onHide}>{t("shopping.removeFromList")}</button>
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className={styles.productToggle}
        onClick={onToggleProducts}
        disabled={productsPending}
      >
        {productsOpen ? t("shopping.hideProducts") : t("shopping.viewProducts")}
      </button>

      {productsOpen ? (
        <ProductPicks
          state={productState}
          onRetry={onRetryProducts}
          ingredientKey={ingredientKey}
          ingredientName={name}
          selectedUrl={selectedUrl}
          selectionEnabled={!checked}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}
