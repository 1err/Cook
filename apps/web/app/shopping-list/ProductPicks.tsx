import { WEEE_STORE_LABEL, isSafeWeeeProductUrl } from "@cooking/shared";
import { useT } from "../lib/i18n";
import type { ProductLookupState } from "./productLoading";

type ProductPicksProps = {
  state: ProductLookupState;
  onRetry: () => void;
};

export function ProductPicks({ state, onRetry }: ProductPicksProps) {
  const t = useT();

  const loadingStatus = (message: string) => (
    <div
      className="shop-bento-products__status shop-bento-products__status--loading"
      role="status"
      aria-live="polite"
    >
      <span className="shop-bulk-loading-banner__spinner" aria-hidden />
      <span>{message}</span>
    </div>
  );

  if (state.status === "idle") return null;
  if (state.status === "queued") {
    return loadingStatus(t("shopping.waitingProducts"));
  }
  if (state.status === "loading") {
    return loadingStatus(t("shopping.findingProducts"));
  }
  if (state.status === "error" || state.status === "empty") {
    const message =
      state.status === "error"
        ? t("shopping.productLoadFailed")
        : t("shopping.noProductsFound", { store: WEEE_STORE_LABEL });
    return (
      <div className="shop-bento-products__status">
        <p style={{ margin: 0 }}>{message}</p>
        <button
          type="button"
          className="shop-bento-products__toggle font-headline"
          onClick={onRetry}
        >
          {t("shopping.retryProducts")}
        </button>
      </div>
    );
  }

  const safeProducts = (state.products ?? []).filter((product) =>
    isSafeWeeeProductUrl(product.url),
  );
  if (!safeProducts.length) {
    return (
      <div className="shop-bento-products__status">
        <p style={{ margin: 0 }}>{t("shopping.productLoadFailed")}</p>
        <button
          type="button"
          className="shop-bento-products__toggle font-headline"
          onClick={onRetry}
        >
          {t("shopping.retryProducts")}
        </button>
      </div>
    );
  }

  return (
    <>
      {safeProducts.slice(0, 3).map((product) => (
        <div key={product.url} className="shop-bento-product-card">
          {product.image ? (
            <img src={product.image} alt={product.name} loading="lazy" />
          ) : (
            <div
              className="shop-bento-product-card__img-placeholder"
              aria-hidden
            >
              <span className="material-symbols-outlined">image</span>
            </div>
          )}
          <div className="shop-bento-product-card__body">
            <p className="shop-bento-product-card__name">{product.name}</p>
            <p className="shop-bento-product-card__price">
              {product.price || t("shopping.seeListing")}
            </p>
            <a
              href={product.url}
              target="_blank"
              rel="noreferrer"
              className="shop-bento-product-card__link font-headline"
            >
              {t("shopping.viewOnStore", { store: WEEE_STORE_LABEL })}
            </a>
          </div>
        </div>
      ))}
    </>
  );
}
