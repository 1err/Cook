"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { RequireAuth } from "../components/RequireAuth";
import {
  STORE_LABELS,
  storeSearchUrl,
  getPreferredStore,
  normalizeStore,
  STORE_PREVIEW_ITEMS_KEY,
  type StorePreviewItem,
  buildItemQuery,
} from "../lib/store";

function previewTags(category: string | undefined): { label: string; variant: "tertiary" | "secondary" | "muted" }[] {
  const c = (category || "").trim();
  if (!c || c === "Other") return [{ label: "In stock", variant: "tertiary" }];
  if (c.includes("Pantry")) {
    return [
      { label: "In stock", variant: "tertiary" },
      { label: "Pantry staple", variant: "secondary" },
    ];
  }
  if (c === "Produce" || c === "Bakery") return [{ label: "Fresh", variant: "tertiary" }];
  if (c === "Dairy" || c === "Frozen") return [{ label: "In stock", variant: "tertiary" }];
  if (c === "Meat & Seafood") return [{ label: "Fresh", variant: "tertiary" }];
  return [{ label: "In stock", variant: "tertiary" }];
}

function thumbInitial(name: string): string {
  const t = name.trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

function StorePreviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeParam = searchParams.get("store");
  const preferred = typeof window !== "undefined" ? getPreferredStore() : "weee";
  const store = normalizeStore(storeParam, preferred);

  const [items, setItems] = useState<StorePreviewItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_PREVIEW_ITEMS_KEY);
      if (!raw) {
        setItems([]);
        setReady(true);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setItems([]);
        setReady(true);
        return;
      }
      const list: StorePreviewItem[] = [];
      for (const x of parsed) {
        if (x && typeof x === "object" && "name" in x && typeof (x as { name: unknown }).name === "string") {
          const name = (x as { name: string }).name;
          const suggested_purchase = typeof (x as { suggested_purchase?: unknown }).suggested_purchase === "string"
            ? (x as { suggested_purchase: string }).suggested_purchase
            : "";
          const category =
            typeof (x as { category?: unknown }).category === "string" ? (x as { category: string }).category : undefined;
          list.push({ name, suggested_purchase, category });
        }
      }
      setItems(list);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (items.length === 0) {
      router.replace("/shopping-list");
      return;
    }
  }, [ready, items.length, router]);

  function handleBack() {
    router.push("/shopping-list");
  }

  function openItemSearch(item: StorePreviewItem) {
    const query = buildItemQuery(item);
    if (query) {
      window.open(storeSearchUrl(store, query), "_blank", "noopener,noreferrer");
    }
  }

  function openAll() {
    const query = items.map((item) => buildItemQuery(item)).filter(Boolean).join(" ");
    if (query) {
      window.open(storeSearchUrl(store, query), "_blank", "noopener,noreferrer");
    }
  }

  if (!ready) return <p className="store-preview-muted">Loading…</p>;

  if (items.length === 0) {
    return (
      <div className="store-preview-page">
        <p className="store-preview-muted">No items to preview.</p>
        <Link href="/shopping-list" className="store-preview-link">
          Back to shopping list
        </Link>
      </div>
    );
  }

  const storeLabel = STORE_LABELS[store];
  const searchCta = `Search on ${storeLabel}`;

  return (
    <div className="store-preview-page">
      <header className="store-preview-header">
        <button type="button" className="store-preview-back font-headline" onClick={handleBack}>
          <span className="material-symbols-outlined">arrow_back</span>
          <span>Back to Shopping List</span>
        </button>
        <div className="store-preview-header__row">
          <div>
            <h1 className="store-preview-title font-headline">Store Preview</h1>
            <p className="store-preview-sub">Review and export your curated ingredient list.</p>
          </div>
          <div className="store-preview-store-pill">
            <span className="store-preview-store-pill__name">{storeLabel}</span>
            <span className="store-preview-store-pill__rule" aria-hidden />
            <span className="store-preview-store-pill__badge font-headline">Selected store</span>
          </div>
        </div>
      </header>

      <section className="store-preview-list" aria-label="Items to shop">
        {items.map((item, i) => {
          const tags = previewTags(item.category);
          return (
            <div key={i} className="store-preview-card">
              <div className="store-preview-card__main">
                <div className="store-preview-card__thumb" aria-hidden>
                  <span className="store-preview-card__thumb-letter font-headline">{thumbInitial(item.name)}</span>
                </div>
                <div className="store-preview-card__body">
                  <h3 className="store-preview-card__name font-headline">{item.name}</h3>
                  {item.suggested_purchase ? (
                    <p className="store-preview-card__suggested">Suggested: {item.suggested_purchase}</p>
                  ) : null}
                  <div className="store-preview-card__tags">
                    {tags.map((t) => (
                      <span key={t.label} className={`store-preview-tag store-preview-tag--${t.variant} font-headline`}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="store-preview-search-btn font-headline"
                onClick={() => openItemSearch(item)}
              >
                <span>{searchCta}</span>
                <span className="material-symbols-outlined store-preview-search-btn__icon">open_in_new</span>
              </button>
            </div>
          );
        })}
      </section>

      <footer className="store-preview-footer">
        <h2 className="store-preview-footer__title font-headline">Ready to purchase?</h2>
        <p className="store-preview-footer__sub">
          We&apos;ll open a search on {storeLabel} with your {items.length} item{items.length === 1 ? "" : "s"} so you can
          check out quickly.
        </p>
        <div className="store-preview-footer__actions">
          <button type="button" className="store-preview-footer__primary font-headline" onClick={openAll}>
            <span className="material-symbols-outlined">shopping_basket</span>
            <span>Open all in {storeLabel}</span>
          </button>
          <Link href="/shopping-list" className="store-preview-footer__secondary font-headline">
            Back to Shopping List
          </Link>
        </div>
      </footer>
    </div>
  );
}

export default function StorePreviewPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="store-preview-muted">Loading…</p>}>
        <StorePreviewPageContent />
      </Suspense>
    </RequireAuth>
  );
}
