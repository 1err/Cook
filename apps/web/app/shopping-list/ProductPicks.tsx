import { useId } from "react";
import { WEEE_STORE_LABEL, isSafeWeeeProductUrl } from "@cooking/shared";
import { useT } from "../lib/i18n";
import type { ProductLookupState } from "./productLoading";
import styles from "./ShoppingList.module.css";

type ProductPicksProps = {
  state: ProductLookupState;
  onRetry: () => void;
  ingredientKey?: string;
  ingredientName?: string;
  selectedUrl?: string;
  selectionEnabled?: boolean;
  onSelect?: (productUrl: string) => void;
};

export function ProductPicks({
  state,
  onRetry,
  ingredientKey,
  ingredientName,
  selectedUrl,
  selectionEnabled = true,
  onSelect = () => {},
}: ProductPicksProps) {
  const t = useT();
  const generatedGroupName = useId();
  const radioGroupName = `cart-product-${ingredientKey || "ingredient"}-${generatedGroupName}`;

  if (state.status === "idle") return null;
  if (state.status === "queued" || state.status === "loading") {
    return (
      <div className={styles.productStatus} role="status" aria-live="polite">
        <span className="shop-bulk-loading-banner__spinner" aria-hidden />
        <span>{state.status === "queued" ? t("shopping.waitingProducts") : t("shopping.findingProducts")}</span>
      </div>
    );
  }

  if (state.status === "error" || state.status === "empty") {
    return (
      <div className={styles.productStatus}>
        <p>
          {state.status === "error"
            ? t("shopping.productLoadFailed")
            : t("shopping.noProductsFound", { store: WEEE_STORE_LABEL })}
        </p>
        <button type="button" onClick={onRetry}>{t("shopping.retryProducts")}</button>
      </div>
    );
  }

  const safeProducts = (state.products ?? []).filter((product) => isSafeWeeeProductUrl(product.url));
  if (!safeProducts.length) {
    return (
      <div className={styles.productStatus}>
        <p>{t("shopping.productLoadFailed")}</p>
        <button type="button" onClick={onRetry}>{t("shopping.retryProducts")}</button>
      </div>
    );
  }

  const visibleProducts = safeProducts.slice(0, 3);
  const selectedProductUrl = visibleProducts.some((product) => product.url === selectedUrl)
    ? selectedUrl
    : visibleProducts[0].url;

  return (
    <div
      className={styles.productList}
      role={selectionEnabled ? "radiogroup" : undefined}
      aria-label={selectionEnabled
        ? ingredientName
          ? t("shopping.cartChoiceGroup", { name: ingredientName })
          : t("shopping.cartChoiceGroupGeneric")
        : undefined}
    >
      {visibleProducts.map((product, index) => {
        const selected = selectionEnabled && product.url === selectedProductUrl;
        return (
          <div
            key={product.url}
            className={`${styles.productRow} ${selected ? styles.productRowSelected : ""}`}
            data-testid="store-product-row"
          >
            {product.image ? (
              <img src={product.image} alt={product.name} loading="lazy" />
            ) : (
              <div className={styles.productPlaceholder} aria-hidden>CW</div>
            )}
            <div className={styles.productCopy}>
              <p>{product.name}</p>
              <strong>{product.price || t("shopping.seeListing")}</strong>
              {selectionEnabled && index === 0 ? (
                <span className={styles.topPick}>{t("shopping.cartTopPick")}</span>
              ) : null}
              {selectionEnabled ? (
                <label className={styles.productChoice}>
                  <input
                    type="radio"
                    name={radioGroupName}
                    value={product.url}
                    checked={selected}
                    aria-label={selected
                      ? t("shopping.cartSelectedProduct", { name: product.name })
                      : t("shopping.cartChooseProduct", { name: product.name })}
                    onChange={() => {
                      if (!selected) onSelect(product.url);
                    }}
                  />
                  <span>{selected ? t("shopping.cartSelected") : t("shopping.cartChoose")}</span>
                </label>
              ) : null}
              <a
                href={product.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t("shopping.viewOnStore", { store: WEEE_STORE_LABEL })}
              >
                {t("shopping.viewOnStore", { store: WEEE_STORE_LABEL })} ↗
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
