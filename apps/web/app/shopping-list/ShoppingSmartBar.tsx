"use client";

import type { Ref } from "react";
import { WEEE_STORE_LABEL } from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./ShoppingList.module.css";

type ShoppingSmartBarProps = {
  itemCount: number;
  totalCount: number;
  stale: boolean;
  fallback?: boolean;
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
  onPrepareMuse: () => void;
};

export function ShoppingSmartBar({
  itemCount,
  totalCount,
  stale,
  fallback = false,
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
  onPrepareMuse,
}: ShoppingSmartBarProps) {
  const t = useT();
  const checkedCount = Math.max(0, totalCount - itemCount);
  const progress = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  return (
    <section className={styles.smartBar} aria-label={t("shopping.controls")}>
      <div className={styles.smartOverview}>
        <div className={styles.smartSummary}>
          <span>{t(fallback ? "shopping.basicList" : "shopping.smartMode")}</span>
          <strong>{itemCount}</strong>
          <small>{t("shopping.toBuy")}</small>
        </div>
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <small className={styles.progressLabel}>{checkedCount} / {totalCount}</small>
      </div>
      <div className={styles.smartActions}>
        {stale || fallback ? (
          <button type="button" onClick={onRefresh} disabled={refining}>
            {refining ? t("shopping.refreshing") : t(fallback ? "shopping.retryRefine" : "shopping.refreshSmartList")}
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
        <button type="button" aria-haspopup="dialog" onClick={onPrepareMuse} disabled={itemCount === 0 || refining}>
          {t("shopping.museEntry")}
        </button>
        <button type="button" className={styles.backButton} onClick={onBack}>
          {t("shopping.backToOriginalList")}
        </button>
      </div>
      <div className={styles.smartGuide}>
        <h2>{t("shopping.guideTitle")}</h2>
        <ol className={styles.smartGuideSteps}>
          <li>
            <strong>{t("shopping.guideCheckTitle")}</strong>
            <p>{t("shopping.guideCheckBody")}</p>
          </li>
          <li>
            <strong>{t("shopping.guideChooseTitle")}</strong>
            <p>{t("shopping.guideChooseBody", {
              loadAction: t("shopping.loadPicks", { store: WEEE_STORE_LABEL }),
            })}</p>
          </li>
          <li>
            <strong>{t("shopping.guideMuseTitle")}</strong>
            <p>{t("shopping.guideMuseBody", { museAction: t("shopping.museEntry") })}</p>
          </li>
        </ol>
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
