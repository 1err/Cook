import { WEEE_STORE_LABEL, isSafeWeeeProductUrl } from "@cooking/shared";
import { useT } from "../lib/i18n";
import type { ProductLookupState } from "./productLoading";
import styles from "./ShoppingList.module.css";

type ProductPicksProps = {
  state: ProductLookupState;
  onRetry: () => void;
};

export function ProductPicks({ state, onRetry }: ProductPicksProps) {
  const t = useT();

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

  return (
    <div className={styles.productList}>
      {safeProducts.slice(0, 3).map((product) => (
        <div key={product.url} className={styles.productRow} data-testid="store-product-row">
          {product.image ? (
            <img src={product.image} alt={product.name} loading="lazy" />
          ) : (
            <div className={styles.productPlaceholder} aria-hidden>CW</div>
          )}
          <div className={styles.productCopy}>
            <p>{product.name}</p>
            <strong>{product.price || t("shopping.seeListing")}</strong>
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
      ))}
    </div>
  );
}
