"use client";

import { useEffect, useRef, useState } from "react";
import {
  getWeeeProductDisplayName,
  isSafeWeeeProductUrl,
  type CartAssistantDraft,
  type CartAssistantIngredient,
} from "@cooking/shared";
import { useT } from "../lib/i18n";
import styles from "./ShoppingList.module.css";

type CartAssistantDialogProps = {
  open: boolean;
  draft: CartAssistantDraft;
  pendingIngredients: Array<Pick<CartAssistantIngredient, "key" | "name" | "suggestedPurchase">>;
  skippedTokens: ReadonlySet<string>;
  onClose: () => void;
  onOpenProduct: (productUrl: string) => void;
  onConfirm: (confirmationToken: string) => void;
  onUndoConfirm: (confirmationToken: string) => void;
  onSkip: (confirmationToken: string) => void;
  onFindMatch: (ingredientKey: string) => void;
};

const WEEE_HOME_URL = "https://www.sayweee.com/";

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CartAssistantDialog({
  open,
  draft,
  pendingIngredients,
  skippedTokens,
  onClose,
  onOpenProduct,
  onConfirm,
  onUndoConfirm,
  onSkip,
  onFindMatch,
}: CartAssistantDialogProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const nativeModalRef = useRef(false);
  const [attemptedTokens, setAttemptedTokens] = useState<Set<string>>(new Set());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      nativeModalRef.current = false;
      setAttemptedTokens((current) => current.size ? new Set() : current);
      if (dialog.open && typeof dialog.close === "function") {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute("open");
        }
      } else {
        dialog.removeAttribute("open");
      }
      return;
    }

    nativeModalRef.current = false;
    if (typeof dialog.showModal === "function") {
      try {
        if (!dialog.open) dialog.showModal();
        nativeModalRef.current = true;
      } catch {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
    closeButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !nativeModalRef.current) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const current = draft.selections.find(
    (selection) => (
      !selection.confirmed
      && !skippedTokens.has(selection.confirmationToken)
      && isSafeWeeeProductUrl(selection.product.url)
    ),
  );
  const safeSelectionCount = draft.selections.filter(
    (selection) => isSafeWeeeProductUrl(selection.product.url),
  ).length;
  const hasSkippedSelection = draft.selections.some(
    (selection) => (
      !selection.confirmed
      && skippedTokens.has(selection.confirmationToken)
      && isSafeWeeeProductUrl(selection.product.url)
    ),
  );
  const currentWasAttempted = current ? attemptedTokens.has(current.confirmationToken) : false;

  return (
    <dialog
      ref={dialogRef}
      className={styles.cartDialog}
      aria-modal="true"
      aria-labelledby="weee-cart-review-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
        <header className={styles.cartDialogHeader}>
          <div>
            <span>{t("shopping.cartEyebrow")}</span>
            <h2 id="weee-cart-review-title" className="cw-display">
              {t("shopping.cartTitle")}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("shopping.cartClose")}
          >
            ×
          </button>
        </header>

        <div className={styles.cartDialogBody}>
          <div className={styles.cartSummary} aria-label={t("shopping.cartSummaryLabel")}>
            <strong>{t("shopping.cartReadyCount", { count: draft.summary.readyCount })}</strong>
            <span>{t("shopping.cartUnmatchedCount", { count: draft.summary.unmatchedCount })}</span>
            {pendingIngredients.length > 0 ? (
              <span>{t(
                pendingIngredients.length === 1
                  ? "shopping.cartPendingCountOne"
                  : "shopping.cartPendingCountMany",
                { count: pendingIngredients.length },
              )}</span>
            ) : null}
            <span>{t("shopping.cartConfirmedCount", { count: draft.summary.confirmedCount })}</span>
          </div>
          <p className={styles.cartEstimate}>
            {t("shopping.cartEstimate", {
              amount: formatUsd(draft.summary.estimatedSubtotalCents),
            })}
          </p>
          {draft.summary.unpricedCount > 0 ? (
            <p className={styles.cartDisclosure}>
              {t(
                draft.summary.unpricedCount === 1
                  ? "shopping.cartUnpricedOne"
                  : "shopping.cartUnpricedMany",
                { count: draft.summary.unpricedCount },
              )}
            </p>
          ) : null}

          <ul className={styles.cartSelectionList}>
            {draft.selections.map((selection) => (
              <li key={selection.confirmationToken}>
                <div>
                  <strong>{selection.ingredientName}</strong>
                  <span>{selection.suggestedPurchase}</span>
                  <small>{getWeeeProductDisplayName(selection.product.name)} · {selection.product.price || t("shopping.seeListing")}</small>
                </div>
                {selection.confirmed ? (
                  <button
                    type="button"
                    onClick={() => onUndoConfirm(selection.confirmationToken)}
                    aria-label={t("shopping.cartUndoItem", { name: selection.ingredientName })}
                  >
                    {t("shopping.cartUndo")}
                  </button>
                ) : skippedTokens.has(selection.confirmationToken) ? (
                  <span>{t("shopping.cartSkipped")}</span>
                ) : null}
              </li>
            ))}
          </ul>

          {current ? (
            <section className={styles.cartCurrent} aria-live="polite">
              <h3>{t("shopping.cartNext", { name: current.ingredientName })}</h3>
              <p>{t("shopping.cartCurrentDetail", {
                amount: current.suggestedPurchase,
                product: getWeeeProductDisplayName(current.product.name),
              })}</p>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setAttemptedTokens((tokens) => new Set(tokens).add(current.confirmationToken));
                    onOpenProduct(current.product.url);
                  }}
                >
                  {t(currentWasAttempted ? "shopping.cartOpenAgain" : "shopping.cartOpenNext")}
                </button>
                <a
                  className={styles.cartDirectLink}
                  href={current.product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("shopping.cartDirectLink", { name: getWeeeProductDisplayName(current.product.name) })}
                >
                  {t("shopping.cartDirectLink", { name: getWeeeProductDisplayName(current.product.name) })}
                </a>
                <button type="button" onClick={() => onConfirm(current.confirmationToken)}>
                  {t("shopping.cartConfirm")}
                </button>
                <button type="button" onClick={() => onSkip(current.confirmationToken)}>
                  {t("shopping.cartSkip")}
                </button>
              </div>
            </section>
          ) : safeSelectionCount > 0 && pendingIngredients.length === 0 ? (
            <section className={styles.cartCurrent} aria-live="polite">
              <h3>{t(
                hasSkippedSelection
                  ? "shopping.cartReviewPassComplete"
                  : "shopping.cartHandoffComplete",
              )}</h3>
              <p>{t("shopping.cartFinalReviewDetail")}</p>
              <a href={WEEE_HOME_URL} target="_blank" rel="noopener noreferrer">
                {t("shopping.cartFinalReview")}
              </a>
            </section>
          ) : null}

          {pendingIngredients.length > 0 ? (
            <section className={styles.cartPending}>
              <h3>{t("shopping.cartPendingTitle")}</h3>
              <ul>
                {pendingIngredients.map((ingredient) => (
                  <li key={ingredient.key}>
                    <span>{ingredient.name} — {ingredient.suggestedPurchase}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {draft.unmatched.length > 0 ? (
            <section className={styles.cartUnmatched}>
              <h3>{t("shopping.cartUnmatchedTitle")}</h3>
              <ul>
                {draft.unmatched.map((ingredient) => (
                  <li key={ingredient.key}>
                    <span>{ingredient.name} — {ingredient.suggestedPurchase}</span>
                    <button
                      type="button"
                      onClick={() => onFindMatch(ingredient.key)}
                      aria-label={t("shopping.cartFindMatchItem", { name: ingredient.name })}
                    >
                      {t("shopping.cartFindMatch")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className={styles.cartTrust}>{t("shopping.cartTrust")}</p>
      </div>
    </dialog>
  );
}
