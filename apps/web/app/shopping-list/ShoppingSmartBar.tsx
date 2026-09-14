"use client";

import type { Ref } from "react";
import { WEEE_STORE_LABEL } from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./ShoppingList.module.css";

type ShoppingSmartBarProps = {
  itemCount: number;
  stale: boolean;
  refining: boolean;
  copied: boolean;
  bulkLoading: boolean;
  bulkProgress: { current: number; total: number } | null;
  cartReadyCount: number;
  loadButtonRef: Ref<HTMLButtonElement>;
  reviewButtonRef: Ref<HTMLButtonElement>;
  onBack: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  onLoadProducts: () => void;
  onReviewCart: () => void;
};

export function ShoppingSmartBar({
  itemCount,
  stale,
  refining,
  copied,
  bulkLoading,
  bulkProgress,
  cartReadyCount,
  loadButtonRef,
  reviewButtonRef,
  onBack,
  onRefresh,
  onCopy,
  onLoadProducts,
  onReviewCart,
}: ShoppingSmartBarProps) {
  const t = useT();

  return (
    <section className={styles.smartBar} aria-label="Smart shopping list controls">
      <div className={styles.smartSummary}>
        <span>{t("shopping.smartMode")}</span>
        <strong>{itemCount}</strong>
        <small>{t("shopping.toBuy")}</small>
      </div>
      <div className={styles.smartActions}>
        {stale ? (
          <button type="button" onClick={onRefresh} disabled={refining}>
            {refining ? t("shopping.refreshing") : t("shopping.refreshSmartList")}
          </button>
        ) : null}
        <button type="button" onClick={onCopy}>{copied ? t("shopping.copied") : t("shopping.copyList")}</button>
        <button
          ref={loadButtonRef}
          type="button"
          onClick={onLoadProducts}
          disabled={bulkLoading || itemCount === 0}
        >
          {bulkLoading
            ? t("shopping.loadingPicks", { store: WEEE_STORE_LABEL })
            : t("shopping.loadPicks", { store: WEEE_STORE_LABEL })}
        </button>
        {cartReadyCount > 0 ? (
          <button
            ref={reviewButtonRef}
            type="button"
            className={styles.cartReviewButton}
            aria-haspopup="dialog"
            onClick={onReviewCart}
          >
            {t("shopping.reviewCart", { count: cartReadyCount })}
          </button>
        ) : null}
        <button type="button" className={styles.backButton} onClick={onBack}>
          {t("shopping.backToOriginalList")}
        </button>
      </div>
      {bulkLoading && bulkProgress ? (
        <p className={styles.bulkStatus} role="status">
          {t("shopping.loadingMatches", {
            current: bulkProgress.current,
            total: bulkProgress.total,
          })}
        </p>
      ) : null}
    </section>
  );
}
