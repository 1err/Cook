"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildMuseCartDraft, buildMuseShoppingPrompt, getWeeeProductDisplayName, getMusePackSuggestion, parseMuseBudgetCents, parseMusePackCount,
  type CartAssistantDraft, type CartAssistantIngredient, type MuseQuantitySource,
} from "@cooking/shared";
import { useI18n, useT } from "../lib/i18n";
import styles from "./MuseShoppingDialog.module.css";

export type MuseShoppingDialogProps = {
  open: boolean;
  draft: CartAssistantDraft;
  pendingIngredients: Array<Pick<CartAssistantIngredient, "key" | "name" | "suggestedPurchase">>;
  scopeKey: string;
  stale?: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshError?: string | null;
  refinementFallback?: boolean;
};

export function MuseShoppingDialog(props: MuseShoppingDialogProps) {
  return <MuseShoppingReview key={props.scopeKey} {...props} />;
}

function MuseShoppingReview({ open, draft, pendingIngredients, stale = false, onClose, onRefresh, refreshing = false, refreshError = null, refinementFallback = false }: MuseShoppingDialogProps) {
  const t = useT();
  const { language } = useI18n();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openMuseRef = useRef<HTMLAnchorElement>(null);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [packOverrides, setPackOverrides] = useState<Record<string, string>>({});
  const [packageSizes, setPackageSizes] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState("");
  const [substitutionPolicy, setSubstitutionPolicy] = useState<"ask" | "skip">("ask");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<{ prompt: string; status: "copied" | "error" } | null>(null);
  const [reviewedSignature, setReviewedSignature] = useState<string | null>(null);
  const generation = useRef(0);
  const museDraft = useMemo(() => buildMuseCartDraft(draft, pendingIngredients), [draft, pendingIngredients]);
  const suggestions = useMemo(() => new Map(museDraft.items.map((item) => [item.id, getMusePackSuggestion(item, language, packageSizes[item.id])])), [museDraft, language, packageSizes]);
  const packCounts = Object.fromEntries(museDraft.items.map((item) => {
    const suggestion = suggestions.get(item.id)!;
    return [item.id, packOverrides[item.id] ?? (suggestion.status !== "unavailable" ? String(suggestion.packs) : "")];
  }));
  const quantitySources: Record<string, MuseQuantitySource> = Object.fromEntries(museDraft.items.map((item) => {
    const suggestion = suggestions.get(item.id)!;
    return [item.id, packOverrides[item.id] !== undefined ? "manual" : suggestion.status === "starter" ? "starting"
      : suggestion.status === "suggested" && suggestion.approximate ? "estimated" : "calculated"];
  }));
  const uncertainCount = Object.values(quantitySources).filter((source) => source === "estimated" || source === "starting").length;
  const reviewSignature = JSON.stringify([museDraft.signature, packCounts, packageSizes, quantitySources, budget, substitutionPolicy, language]);
  const candidatePrompt = stale || refreshing ? null
    : buildMuseShoppingPrompt({ draft: museDraft, packCounts, packageSizes, quantitySources, budget, substitutionPolicy, language });
  const prompt = reviewedSignature === reviewSignature ? candidatePrompt : null;
  const currentRequest = useRef(candidatePrompt);
  currentRequest.current = open ? candidatePrompt : null;
  const budgetInvalid = budget.trim() !== "" && parseMuseBudgetCents(budget) === null;
  const invalidIndex = museDraft.items.findIndex((item) => parseMusePackCount(packCounts[item.id] ?? "") === null);
  const result = prompt && copyResult?.prompt === prompt ? copyResult.status : null;

  useEffect(() => {
    generation.current += 1;
    setReviewedSignature(null); setCopyResult(null); setCopying(false); setPreviewOpen(false);
  }, [reviewSignature, stale, refreshing]);

  useEffect(() => {
    const itemIds = new Set(museDraft.items.map((item) => item.id));
    setPackOverrides((current) => {
      const retained = Object.entries(current).filter(([itemId]) => itemIds.has(itemId));
      return retained.length === Object.keys(current).length ? current : Object.fromEntries(retained);
    });
    setPackageSizes((current) => {
      const retained = Object.entries(current).filter(([itemId]) => itemIds.has(itemId));
      return retained.length === Object.keys(current).length ? current : Object.fromEntries(retained);
    });
  }, [museDraft.items]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let nativeModal = false;
    try {
      if (typeof dialog.showModal === "function") { dialog.showModal(); nativeModal = true; }
      else dialog.setAttribute("open", "");
    } catch { dialog.setAttribute("open", ""); }
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !nativeModal) { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== "Tab" || nativeModal) return;
      const controls = Array.from(dialog!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea, summary'))
        .filter((element) => !element.closest("details:not([open])") || element.tagName === "SUMMARY");
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      generation.current += 1;
      setCopying(false); setCopyResult(null);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (dialog.open && nativeModal && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (result === "error") { previewRef.current?.focus(); previewRef.current?.select(); }
    if (result === "copied") openMuseRef.current?.focus({ preventScroll: true });
  }, [result]);

  async function copyRequest() {
    if (!candidatePrompt || copying) return;
    const request = candidatePrompt; const attempt = ++generation.current;
    setReviewedSignature(reviewSignature);
    setCopying(true); setCopyResult(null);
    try {
      await navigator.clipboard.writeText(request);
      if (generation.current === attempt && currentRequest.current === request) setCopyResult({ prompt: request, status: "copied" });
    } catch {
      if (generation.current === attempt && currentRequest.current === request) {
        setPreviewOpen(true); setCopyResult({ prompt: request, status: "error" });
      }
    } finally { if (generation.current === attempt) setCopying(false); }
  }

  function saveRequest() {
    if (!prompt) return;
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "chef-world-muse-shopping.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function focusInput(inputId: string) {
    const input = document.getElementById(inputId);
    let parent = input?.parentElement;
    while (parent && parent !== dialogRef.current) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    input?.focus();
    input?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }

  function primaryAction() {
    if (stale || refreshing) { if (!refreshing) (onRefresh ?? onClose)(); return; }
    if (!museDraft.items.length) { onClose(); return; }
    if (invalidIndex !== -1) { focusInput(`${id}-packs-${invalidIndex}`); return; }
    if (budgetInvalid) { focusInput(`${id}-budget`); return; }
    void copyRequest();
  }

  const actionKey = refreshing ? "museUpdating" : stale ? "museUpdateList"
    : !museDraft.items.length ? "museChooseProducts" : invalidIndex !== -1 ? "museFixQuantities"
    : budgetInvalid ? "museFixBudget" : copying ? "museCopying" : "museConfirmCopy";
  const footerKey = stale || refreshing ? "museUpdateHelp" : invalidIndex !== -1 ? "museFixQuantitiesHelp"
    : budgetInvalid ? "museBudgetError" : uncertainCount ? "museConfirmEstimateHelp" : "museConfirmHelp";

  return <dialog ref={dialogRef} className={styles.dialog} aria-modal="true" aria-labelledby={`${id}-title`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    {open ? <>
      <header className={styles.header}>
        <div className={styles.headingRow}>
          <h2 id={`${id}-title`} className="cw-display">{t("shopping.museReviewTitle")}</h2>
          <button type="button" className={styles.close} ref={closeRef} onClick={onClose} aria-label={t("shopping.museClose")}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p>{t("shopping.museReviewIntro")}</p>
        <ol className={styles.steps} aria-label={t("shopping.museReviewSteps")}>
          <li className={result === "copied" ? undefined : styles.stepActive} aria-current={result === "copied" ? undefined : "step"}><span>1</span>{t("shopping.museReviewStep")}</li>
          <li className={result === "copied" ? styles.stepActive : undefined} aria-current={result === "copied" ? "step" : undefined}><span>2</span>{t("shopping.musePasteStep")}</li>
        </ol>
      </header>
      <div className={styles.body}>
        {refinementFallback ? <div className={styles.alert}>
          <p role="status">{t("shopping.refineFallback")}</p>
          {!stale && onRefresh ? <button type="button" className={styles.secondary} onClick={onRefresh} disabled={refreshing}>
            {t(refreshing ? "shopping.refreshing" : "shopping.retryRefine")}
          </button> : null}
        </div> : null}
        {refreshError && (stale || refreshing) ? <p className={styles.alert} role="alert">{refreshError}</p> : null}
        <section className={styles.products} aria-labelledby={`${id}-products`}>
          <div className={styles.sectionHeading}>
            <h3 id={`${id}-products`}>{t("shopping.museReviewProducts", { count: museDraft.items.length })}</h3>
            <span>{t("shopping.museReviewTotalPacks")}</span>
          </div>
          {museDraft.items.length === 0 ? <p className={styles.empty}>{t(museDraft.alreadyConfirmedCount > 0 ? "shopping.museAllAdded" : "shopping.museEmpty")}</p> : null}
          <ul className={styles.productList}>
            {museDraft.items.map((item, index) => {
              const displayName = getWeeeProductDisplayName(item.product.name);
              const value = packCounts[item.id] ?? "";
              const count = parseMusePackCount(value);
              const invalid = count === null;
              const suggestion = suggestions.get(item.id)!;
              const source = quantitySources[item.id];
              const suggestionId = `${id}-suggestion-${index}`;
              const badgeKey = invalid ? "museBadgeNeedsCount" : source === "manual" ? "museBadgeManual"
                : source === "starting" ? "museBadgeStarting" : source === "estimated" ? "museBadgeEstimated" : "museBadgeCalculated";
              return <li key={item.id} className={styles.product}>
                <div className={styles.productCopy}>
                  <strong>{displayName}</strong>
                  {item.ingredients.map((ingredient, position) => <p key={position}>{ingredient.name} · {ingredient.suggestedPurchase}</p>)}
                  <div className={styles.productMeta}>
                    <span>{item.product.price ? t("shopping.museReviewPrice", { price: item.product.price }) : t("shopping.musePriceUnknown")}</span>
                    <span className={`${styles.badge} ${source === "starting" || invalid ? styles.badgeStarter : source === "estimated" ? styles.badgeEstimate : source === "manual" ? styles.badgeManual : ""}`}>{t(`shopping.${badgeKey}`)}</span>
                  </div>
                  {source === "starting" && !invalid ? <p className={styles.starterHint}>{t("shopping.museStartingShort")}</p> : null}
                </div>
                <div className={styles.quantity}>
                  <label htmlFor={`${id}-packs-${index}`}>{t("shopping.museReviewPacks")}</label>
                  <div className={styles.quantityControl}>
                    <button type="button" className={styles.quantityButton} aria-label={t("shopping.museDecrease", { name: displayName })} disabled={count === 1}
                      onClick={() => setPackOverrides((current) => ({ ...current, [item.id]: String(Math.max(1, (count ?? 2) - 1)) }))}>−</button>
                    <input id={`${id}-packs-${index}`} aria-label={t("shopping.musePackLabel", { name: displayName })}
                      type="number" inputMode="numeric" min="1" max="99" step="1" placeholder="—" value={value}
                      aria-invalid={invalid} aria-describedby={invalid ? `${id}-pack-error-${index}` : undefined}
                      onChange={(event) => setPackOverrides((counts) => ({ ...counts, [item.id]: event.target.value }))} />
                    <button type="button" className={styles.quantityButton} aria-label={t("shopping.museIncrease", { name: displayName })} disabled={count === 99}
                      onClick={() => setPackOverrides((current) => ({ ...current, [item.id]: String(Math.min(99, (count ?? 0) + 1)) }))}>+</button>
                  </div>
                  {invalid ? <small id={`${id}-pack-error-${index}`} className={styles.error}>{t("shopping.musePackError")}</small> : null}
                </div>
                {suggestion.status === "unavailable" ? <p className={styles.suggestionUnavailable}>{t({
                  "package-size": "shopping.musePackSizeUnknown", "ingredient-amount": "shopping.musePackAmountUnknown",
                  "unit-mismatch": "shopping.musePackUnitMismatch", "too-many-packs": "shopping.musePackTooMany",
                  "already-added": "shopping.musePackAlreadyAdded",
                }[suggestion.reason])}</p> : null}
                <details className={styles.productDetails}>
                  <summary className={styles.detailsToggle} aria-label={t("shopping.museDetailsLabel", { name: displayName })}>{t("shopping.museDetails")}</summary>
                  {suggestion.status !== "unavailable" ? <div id={suggestionId} className={styles.suggestion}>
                    <div className={styles.suggestionHeading}>
                      <strong>{t(suggestion.status === "starter" ? "shopping.museStarterPack" : suggestion.approximate
                        ? (suggestion.packs === 1 ? "shopping.museEstimatedPack" : "shopping.museEstimatedPacks")
                        : (suggestion.packs === 1 ? "shopping.museSuggestedPack" : "shopping.museSuggestedPacks"), { count: suggestion.packs })}</strong>
                      {packOverrides[item.id] !== undefined ? <button type="button" className={styles.textButton}
                        aria-label={t("shopping.museUseSuggestionLabel", { name: displayName })}
                        onClick={() => setPackOverrides((current) => { const next = { ...current }; delete next[item.id]; return next; })}>{t("shopping.museUseSuggestion")}</button> : null}
                    </div>
                    {suggestion.status === "starter" ? <p>{t({
                      "package-size": "shopping.museStarterSizeUnknown", "ingredient-amount": "shopping.museStarterAmountUnknown",
                      "unit-mismatch": "shopping.museStarterUnitMismatch",
                    }[suggestion.reason])}</p> : <>
                      <p>{t(suggestion.approximate ? "shopping.museEstimateCalculation" : "shopping.musePackCalculation", { needed: suggestion.requiredAmount, size: suggestion.packageAmount })}</p>
                      <small>{t(suggestion.approximate ? "shopping.museEstimateCoverage" : "shopping.musePackCoverage", { total: suggestion.totalAmount, leftover: suggestion.leftoverAmount })}</small>
                    </>}
                  </div> : null}
                  <div className={styles.packageSize}>
                    <label htmlFor={`${id}-size-${index}`}>{t("shopping.musePackageSize")}</label>
                    <input id={`${id}-size-${index}`} type="text" maxLength={100}
                      aria-label={t("shopping.musePackageSizeLabel", { name: displayName })}
                      placeholder={t("shopping.musePackageSizePlaceholder")} value={packageSizes[item.id] ?? ""}
                      onChange={(event) => setPackageSizes((current) => ({ ...current, [item.id]: event.target.value }))} />
                    <a className={styles.productLink} href={item.product.url} target="_blank" rel="noopener noreferrer" aria-label={t("shopping.museProductLinkLabel", { name: displayName })}>{t("shopping.museViewProduct")} <span aria-hidden="true">↗</span></a>
                  </div>
                </details>
              </li>;
            })}
          </ul>
          {museDraft.alreadyConfirmedCount > 0 ? <p className={styles.help}>{t("shopping.museAlreadyConfirmed", { count: museDraft.alreadyConfirmedCount })}</p> : null}
          {museDraft.unresolved.length > 0 ? <details className={styles.unresolved}>
            <summary>{t("shopping.museLeftOut", { count: museDraft.unresolved.length })}</summary>
            <ul>{museDraft.unresolved.map((item) => <li key={item.key}><span><strong>{item.name}</strong> · {item.suggestedPurchase}</span><small>{t(item.reason === "pending" ? "shopping.musePending" : "shopping.museUnmatched")}</small></li>)}</ul>
          </details> : null}
        </section>
        <details className={styles.preferences}>
          <summary className={styles.preferencesSummary} aria-label={t("shopping.museReviewPreferences")}>
            {t("shopping.museReviewPreferences")}<small>{t(substitutionPolicy === "ask" ? "shopping.musePreferenceAsk" : "shopping.musePreferenceSkip")}{budget.trim() && !budgetInvalid ? ` · $${budget}` : ""}</small>
          </summary>
          <div className={styles.preferencesBody}>
            <fieldset>
              <legend>{t("shopping.museSubstitutions")}</legend>
              {(["ask", "skip"] as const).map((policy) => <label className={styles.radio} key={policy}>
                <input type="radio" name={`${id}-substitutions`} value={policy} checked={substitutionPolicy === policy} onChange={() => setSubstitutionPolicy(policy)} />
                {t(policy === "ask" ? "shopping.museAsk" : "shopping.museSkip")}
              </label>)}
            </fieldset>
            <label className={styles.budgetLabel} htmlFor={`${id}-budget`}>{t("shopping.museBudget")}</label>
            <div className={styles.budgetInput}><span aria-hidden="true">$</span><input id={`${id}-budget`} type="text" inputMode="decimal" placeholder="45.00" maxLength={8} value={budget} onChange={(event) => setBudget(event.target.value)} aria-invalid={budgetInvalid} aria-describedby={`${id}-budget-help${budgetInvalid ? ` ${id}-budget-error` : ""}`} /></div>
            {budgetInvalid ? <p id={`${id}-budget-error`} className={styles.error}>{t("shopping.museBudgetError")}</p> : null}
            <p id={`${id}-budget-help`} className={styles.help}>{t("shopping.museBudgetHelp")}</p>
          </div>
        </details>
        {prompt ? <details className={styles.preview} open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
          <summary>{t("shopping.musePreview")}</summary>
          <textarea ref={previewRef} aria-label={t("shopping.musePreviewLabel")} value={prompt} readOnly rows={9} spellCheck={false} />
          <button type="button" className={styles.textButton} onClick={saveRequest}>{t("shopping.museDownload")}</button>
        </details> : null}
      </div>
      <footer className={styles.footer}>
        <div id={`${id}-action-help`} className={styles.footerCopy}>
          {result === "copied" ? <p className={styles.successTitle} role="status">{t("shopping.museReviewCopied")}</p>
            : result === "error" ? <p className={styles.error} role="alert">{t("shopping.museCopyError")}</p>
            : <p className={styles.statusMessage} aria-live="polite">{t(`shopping.${footerKey}`, { count: uncertainCount })}</p>}
        </div>
        <div className={styles.actions}>
          {result === "copied" ? <>
            <a ref={openMuseRef} className={styles.primary} href="https://muse.ai/" target="_blank" rel="noopener noreferrer">{t("shopping.museOpenAction")} <span aria-hidden="true">↗</span></a>
            <button type="button" className={styles.copyAgain} onClick={() => void copyRequest()} disabled={copying}>{t("shopping.museCopyAgain")}</button>
          </> : <button type="button" className={styles.primary} onClick={primaryAction} disabled={copying || refreshing} aria-describedby={`${id}-action-help`}>{t(`shopping.${actionKey}`)}</button>}
        </div>
        <small className={styles.boundary}>{t("shopping.museReviewBoundary")}</small>
      </footer>
    </> : null}
  </dialog>;
}
