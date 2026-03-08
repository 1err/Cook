"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { RequireAuth } from "../components/RequireAuth";
import {
  type Store,
  STORE_LABELS,
  storeSearchUrl,
  getPreferredStore,
  normalizeStore,
  STORE_PREVIEW_ITEMS_KEY,
  type StorePreviewItem,
  buildItemQuery,
} from "../lib/store";

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
          list.push({ name, suggested_purchase });
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

  if (!ready) return <p style={mutedStyle}>Loading…</p>;

  if (items.length === 0) {
    return (
      <div style={pageStyle}>
        <p style={mutedStyle}>No items to preview.</p>
        <Link href="/shopping-list" style={linkStyle}>
          ← Back to shopping list
        </Link>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <button type="button" onClick={handleBack} style={backButtonStyle} aria-label="Back to shopping list">
          ←
        </button>
        <h1 style={h1Style}>Store preview</h1>
      </div>
      <div style={storeBadgeWrap}>
        <span style={storeBadgeStyle}>{STORE_LABELS[store]}</span>
      </div>

      <p style={mutedStyle}>
        Tap &quot;Search on {STORE_LABELS[store]}&quot; to open each item in a new tab.
      </p>

      <ul style={listStyle}>
        {items.map((item, i) => (
          <li key={i} style={cardStyle}>
            <div style={cardBodyStyle}>
              <span style={itemNameStyle}>{item.name}</span>
              {item.suggested_purchase && (
                <span style={suggestedStyle}>{item.suggested_purchase}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => openItemSearch(item)}
              style={searchButtonStyle}
            >
              Search on {STORE_LABELS[store]}
            </button>
          </li>
        ))}
      </ul>

      <div style={bottomStyle}>
        <button type="button" onClick={openAll} style={openAllButtonStyle}>
          Open all in {STORE_LABELS[store]}
        </button>
      </div>
    </div>
  );
}

export default function StorePreviewPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p style={mutedStyle}>Loading…</p>}>
        <StorePreviewPageContent />
      </Suspense>
    </RequireAuth>
  );
}

const pageStyle: React.CSSProperties = {
  minWidth: 0,
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
  marginBottom: "var(--space-24)",
};

const linkStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontWeight: 500,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-12)",
  marginBottom: "var(--space-8)",
};

const storeBadgeWrap: React.CSSProperties = {
  marginBottom: "var(--space-24)",
};

const storeBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "var(--space-8) var(--space-16)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  fontSize: "0.9rem",
  fontWeight: 500,
  color: "var(--muted)",
};

const backButtonStyle: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  fontSize: "1.25rem",
  cursor: "pointer",
};

const h1Style: React.CSSProperties = {
  fontSize: "var(--font-title)",
  fontWeight: 600,
  margin: 0,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0 0 var(--space-32) 0",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-16)",
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  padding: "var(--space-16) var(--space-24)",
  boxShadow: "var(--shadow-card)",
};

const cardBodyStyle: React.CSSProperties = {
  marginBottom: "var(--space-16)",
};

const itemNameStyle: React.CSSProperties = {
  display: "block",
  fontSize: "1.1rem",
  fontWeight: 600,
  marginBottom: "0.25rem",
};

const suggestedStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.9rem",
  color: "var(--muted)",
};

const searchButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "var(--space-12) var(--space-24)",
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: "var(--radius-btn)",
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
};

const bottomStyle: React.CSSProperties = {
  paddingTop: "var(--space-12)",
};

const openAllButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "var(--space-12) var(--space-24)",
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: "var(--radius-btn)",
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
};
