"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildMuseCartDraft, buildMuseShoppingPrompt, getMusePackSuggestion, parseMuseBudgetCents, parseMusePackCount,
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
};

export function MuseShoppingDialog(props: MuseShoppingDialogProps) {
  return <MuseShoppingReview key={props.scopeKey} {...props} />;
}

function MuseShoppingReview({ open, draft, pendingIngredients, stale = false, onClose }: MuseShoppingDialogProps) {
  const t = useT();
  const { language } = useI18n();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
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
  const listedSuggestions = useMemo(() => new Map(museDraft.items.map((item) => [item.id, getMusePackSuggestion(item, language)])), [museDraft, language]);
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
  const needsEstimateReview = Object.values(quantitySources).some((source) => source === "estimated" || source === "starting");
  const reviewSignature = JSON.stringify([museDraft.signature, packCounts, packageSizes, quantitySources, budget, substitutionPolicy, language]);
  const estimatesReviewed = reviewedSignature === reviewSignature;
  const prompt = stale || (needsEstimateReview && !estimatesReviewed) ? null
    : buildMuseShoppingPrompt({ draft: museDraft, packCounts, packageSizes, quantitySources, budget, substitutionPolicy, language });
  const currentRequest = useRef(prompt);
  currentRequest.current = open ? prompt : null;
  const budgetInvalid = budget.trim() !== "" && parseMuseBudgetCents(budget) === null;
  const result = copyResult?.prompt === prompt ? copyResult.status : null;

  useEffect(() => { setReviewedSignature(null); }, [reviewSignature]);

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
  }, [result]);

  async function copyRequest() {
    if (!prompt) return;
    const request = prompt; const attempt = ++generation.current;
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

  return <dialog ref={dialogRef} className={styles.dialog} aria-modal="true" aria-labelledby={`${id}-title`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    {open ? <>
    <header className={styles.header}>
      <div className={styles.headingRow}>
        <span className={styles.eyebrow}>{t("shopping.museEyebrow")}</span>
        <button type="button" className={styles.close} ref={closeRef} onClick={onClose} aria-label={t("shopping.museClose")}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <h2 id={`${id}-title`} className="cw-display">{t("shopping.museTitle")}</h2>
      <p>{t("shopping.museIntro")}</p>
      <ol className={styles.steps}>
        {["Review", "Copy", "Open"].map((step, index) => <li key={step}><span>{index + 1}</span>{t(`shopping.museStep${step}`)}</li>)}
      </ol>
    </header>
    <div className={styles.body}>
      {stale ? <p className={styles.alert} role="alert">{t("shopping.museStale")}</p> : null}
      <div className={styles.columns}>
        <section className={styles.products} aria-labelledby={`${id}-products`}>
          <div className={styles.sectionHeading}>
            <h3 id={`${id}-products`}>{t("shopping.museProductsTitle")}</h3>
            <span>{t("shopping.museProductCount", { count: museDraft.items.length })}</span>
          </div>
          <p className={styles.help}>{t("shopping.musePackHelp")}</p>
          {museDraft.items.length === 0 ? <p className={styles.empty}>{t(museDraft.alreadyConfirmedCount > 0 ? "shopping.museAllAdded" : "shopping.museEmpty")}</p> : null}
          <ul className={styles.productList}>
            {museDraft.items.map((item, index) => {
              const value = packCounts[item.id] ?? "";
              const invalid = value !== "" && parseMusePackCount(value) === null;
              const suggestion = suggestions.get(item.id)!;
              const listedSuggestion = listedSuggestions.get(item.id)!;
              const showPackageSize = packageSizes[item.id] !== undefined
                || (listedSuggestion.status !== "suggested" && listedSuggestion.reason === "package-size");
              const suggestionId = `${id}-suggestion-${index}`;
              return <li key={item.id} className={styles.product}>
                <span className={styles.productNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.productCopy}>
                  <strong>{item.product.name}</strong>
                  {item.ingredients.map((ingredient, position) => <p key={position}>{ingredient.name} · {t("shopping.museNeeded", { amount: ingredient.suggestedPurchase })}</p>)}
                  <small>{item.product.price ? t("shopping.musePriceReference", { price: item.product.price }) : t("shopping.musePriceUnknown")}</small>
                  <a href={item.product.url} target="_blank" rel="noopener noreferrer" aria-label={t("shopping.museProductLinkLabel", { name: item.product.name })}>{t("shopping.museProductLink")} <span aria-hidden="true">↗</span></a>
                </div>
                <div className={styles.quantity}>
                  <label htmlFor={`${id}-packs-${index}`}>{t("shopping.musePacks")}</label>
                  <input id={`${id}-packs-${index}`} aria-label={t("shopping.musePackLabel", { name: item.product.name })}
                    type="number" inputMode="numeric" min="1" max="99" step="1" placeholder={t("shopping.musePackPlaceholder")}
                    value={value} aria-invalid={invalid} aria-describedby={`${suggestionId}${invalid ? ` ${id}-pack-error-${index}` : ""}`}
                    onChange={(event) => setPackOverrides((counts) => ({ ...counts, [item.id]: event.target.value }))} />
                  {invalid ? <small id={`${id}-pack-error-${index}`} className={styles.error}>{t("shopping.musePackError")}</small> : null}
                </div>
                {suggestion.status !== "unavailable" ? <div id={suggestionId} className={styles.suggestion}>
                  <div className={styles.suggestionHeading}>
                    <strong>{t(suggestion.status === "starter" ? "shopping.museStarterPack" : suggestion.approximate
                      ? (suggestion.packs === 1 ? "shopping.museEstimatedPack" : "shopping.museEstimatedPacks")
                      : (suggestion.packs === 1 ? "shopping.museSuggestedPack" : "shopping.museSuggestedPacks"), { count: suggestion.packs })}</strong>
                    {value !== String(suggestion.packs) ? <button type="button" className={styles.textButton}
                      aria-label={t("shopping.museUseSuggestionLabel", { name: item.product.name })}
                      onClick={() => setPackOverrides((current) => { const next = { ...current }; delete next[item.id]; return next; })}>
                      {t("shopping.museUseSuggestion")}
                    </button> : null}
                  </div>
                  {suggestion.status === "starter" ? <p>{t({
                    "package-size": "shopping.museStarterSizeUnknown",
                    "ingredient-amount": "shopping.museStarterAmountUnknown",
                    "unit-mismatch": "shopping.museStarterUnitMismatch",
                  }[suggestion.reason])}</p> : <>
                    <p>{t(suggestion.approximate ? "shopping.museEstimateCalculation" : "shopping.musePackCalculation", { needed: suggestion.requiredAmount, size: suggestion.packageAmount })}</p>
                    <small>{t(suggestion.approximate ? "shopping.museEstimateCoverage" : "shopping.musePackCoverage", { total: suggestion.totalAmount, leftover: suggestion.leftoverAmount })}</small>
                  </>}
                </div> : <p id={suggestionId} className={styles.suggestionUnavailable}>{t({
                  "package-size": "shopping.musePackSizeUnknown",
                  "ingredient-amount": "shopping.musePackAmountUnknown",
                  "unit-mismatch": "shopping.musePackUnitMismatch",
                  "too-many-packs": "shopping.musePackTooMany",
                  "already-added": "shopping.musePackAlreadyAdded",
                }[suggestion.reason])}</p>}
                <div className={styles.packageSize}>
                  {showPackageSize ? <>
                    <label htmlFor={`${id}-size-${index}`}>{t("shopping.musePackageSize")}</label>
                    <input id={`${id}-size-${index}`} type="text" maxLength={100}
                      aria-label={t("shopping.musePackageSizeLabel", { name: item.product.name })}
                      aria-describedby={`${id}-size-help-${index}`}
                      placeholder={t("shopping.musePackageSizePlaceholder")} value={packageSizes[item.id] ?? ""}
                      onChange={(event) => setPackageSizes((current) => ({ ...current, [item.id]: event.target.value }))} />
                    <small id={`${id}-size-help-${index}`}>{t("shopping.musePackageSizeHelp")}</small>
                  </> : <button type="button" className={styles.textButton}
                    aria-label={t("shopping.museEditPackageSizeLabel", { name: item.product.name })}
                    onClick={() => setPackageSizes((current) => ({ ...current, [item.id]: "" }))}>
                    {t("shopping.museEditPackageSize")}
                  </button>}
                </div>
              </li>;
            })}
          </ul>
          {museDraft.alreadyConfirmedCount > 0 ? <p className={styles.help}>{t("shopping.museAlreadyConfirmed", { count: museDraft.alreadyConfirmedCount })}</p> : null}
          {museDraft.unresolved.length > 0 ? <section className={styles.unresolved} aria-labelledby={`${id}-unresolved`}>
            <h4 id={`${id}-unresolved`}>{t("shopping.museUnresolvedTitle")}</h4>
            <p>{t("shopping.museUnresolvedHelp")}</p>
            <ul>{museDraft.unresolved.map((item) => <li key={item.key}><span><strong>{item.name}</strong> · {item.suggestedPurchase}</span><small>{t(item.reason === "pending" ? "shopping.musePending" : "shopping.museUnmatched")}</small></li>)}</ul>
          </section> : null}
        </section>
        <aside className={styles.preferences} aria-labelledby={`${id}-preferences`}>
          <h3 id={`${id}-preferences`}>{t("shopping.musePreferences")}</h3>
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
          <div className={styles.accountNote}><span aria-hidden="true">↗</span><p>{t("shopping.museAccountHelp")}</p></div>
        </aside>
      </div>
      {prompt ? <details className={styles.preview} open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
        <summary>{t("shopping.musePreview")}</summary>
        <textarea ref={previewRef} aria-label={t("shopping.musePreviewLabel")} value={prompt} readOnly rows={9} spellCheck={false} />
        <button type="button" className={styles.textButton} onClick={saveRequest}>{t("shopping.museDownload")}</button>
      </details> : null}
      <p className={styles.privacy}>{t("shopping.musePrivacy")}</p>
    </div>
    <footer className={styles.footer}>
      <div className={styles.footerCopy}>
        {needsEstimateReview ? <label className={styles.estimateReview}>
          <input type="checkbox" checked={estimatesReviewed} onChange={(event) => setReviewedSignature(event.target.checked ? reviewSignature : null)} />
          <span>{t("shopping.museReviewEstimates")}</span>
        </label> : null}
        {result === "copied" ? <p className={styles.success} role="status">{t("shopping.museCopied")}</p>
          : result === "error" ? <p className={styles.error} role="alert">{t("shopping.museCopyError")}</p>
          : <p>{t(prompt ? "shopping.museQuantityReview" : "shopping.museValidation")}</p>}
        <small>{t("shopping.museBoundary")}</small>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => void copyRequest()} disabled={!prompt || copying}>{t(copying ? "shopping.museCopying" : "shopping.museCopy")}</button>
        <a className={styles.secondary} href="https://muse.ai/" target="_blank" rel="noopener noreferrer">{t("shopping.museOpen")}</a>
      </div>
    </footer>
    </> : null}
  </dialog>;
}
