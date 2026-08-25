"use client";

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
  onBack: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  onLoadProducts: () => void;
};

export function ShoppingSmartBar({
  itemCount,
  stale,
  refining,
  copied,
  bulkLoading,
  bulkProgress,
  onBack,
  onRefresh,
  onCopy,
  onLoadProducts,
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
        <button type="button" onClick={onCopy}>{copied ? "Copied!" : "Copy list"}</button>
        <button type="button" onClick={onLoadProducts} disabled={bulkLoading || itemCount === 0}>
          {bulkLoading
            ? `Loading picks from ${WEEE_STORE_LABEL}…`
            : `Load top picks from ${WEEE_STORE_LABEL}`}
        </button>
        <button type="button" className={styles.backButton} onClick={onBack}>
          {t("shopping.backToOriginalList")}
        </button>
      </div>
      {bulkLoading && bulkProgress ? (
        <p className={styles.bulkStatus} role="status">
          Loading store matches… {bulkProgress.current} of {bulkProgress.total}
        </p>
      ) : null}
    </section>
  );
}
