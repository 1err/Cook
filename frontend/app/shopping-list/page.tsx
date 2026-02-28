"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { getApiBase } from "../config";
import { getWeekBounds, getPrevNextWeek, formatWeekLabel } from "../lib/week";
import {
  type Store,
  STORE_LABELS,
  storeSearchUrl,
  getPreferredStore,
  PREFERRED_STORE_KEY,
  STORE_PREVIEW_ITEMS_KEY,
} from "../lib/store";

const SMART_SHOPPING_LIST_KEY = "smartShoppingList";

interface ShoppingListItem {
  name: string;
  total_quantity: string;
}

interface RefineResponse {
  remove: string[];
  likely_pantry: { name: string; reason: string }[];
  purchase_items: { name: string; suggested_purchase: string }[];
}

// Frontend-only rule-based categories. First match wins. Order matters.
const CATEGORY_ORDER = [
  "Vegetables",
  "Meat & Seafood",
  "Pantry",
  "Dairy",
  "Other",
] as const;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Vegetables": [
    "garlic", "onion", "potato", "carrot", "tomato", "ginger", "scallion",
    "green onion", "cabbage", "broccoli", "spinach", "mushroom", "pepper",
    "celery", "lettuce", "cucumber", "pea", "bean", "corn", "leek", "shallot",
    "bell pepper", "chili", "eggplant", "zucchini", "squash", "kale", "bok choy",
  ],
  "Meat & Seafood": [
    "pork", "beef", "chicken", "fish", "shrimp", "salmon", "tuna", "crab",
    "lamb", "turkey", "sausage", "bacon", "ground meat", "tilapia", "cod",
  ],
  "Pantry": [
    "salt", "sugar", "pepper", "oil", "vinegar", "soy sauce", "flour", "starch",
    "sauce", "broth", "wine", "baking", "honey", "sesame", "stock", "mirin",
    "rice", "noodle", "pasta", "bean paste", "doubanjiang", "spice", "herb",
  ],
  "Dairy": [
    "milk", "cheese", "butter", "cream", "tofu", "egg", "yogurt",
  ],
};

function getCategory(name: string): string {
  const lower = name.toLowerCase();
  for (const cat of CATEGORY_ORDER) {
    if (cat === "Other") continue;
    const keywords = CATEGORY_KEYWORDS[cat];
    if (keywords?.some((k) => lower.includes(k))) return cat;
  }
  return "Other";
}

function groupByCategory(items: ShoppingListItem[]): Map<string, { index: number; item: ShoppingListItem }[]> {
  const map = new Map<string, { index: number; item: ShoppingListItem }[]>();
  items.forEach((item, index) => {
    const cat = getCategory(item.name);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push({ index, item });
  });
  for (const cat of CATEGORY_ORDER) {
    if (map.has(cat)) continue;
    map.set(cat, []);
  }
  return map;
}

export default function ShoppingListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const { start, end, weekParam: currentWeek } = getWeekBounds(weekParam);
  const { prev, next } = getPrevNextWeek(currentWeek);

  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [preferredStore, setPreferredStoreState] = useState<Store>("weee");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [refinedData, setRefinedData] = useState<RefineResponse | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [smartPantryCollapsed, setSmartPantryCollapsed] = useState(false);
  const [smartRemovedCollapsed, setSmartRemovedCollapsed] = useState(true);

  useEffect(() => {
    setPreferredStoreState(getPreferredStore());
  }, []);

  function setPreferredStore(store: Store) {
    setPreferredStoreState(store);
    if (typeof window !== "undefined") {
      localStorage.setItem(PREFERRED_STORE_KEY, store);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${getApiBase()}/shopping-list?start=${start}&end=${end}`);
        if (!res.ok) throw new Error("Failed to load");
        const data: ShoppingListItem[] = await res.json();
        if (!cancelled) {
          setItems(data);
          setSelectedIds(new Set(data.map((_, i) => i)));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  // Restore refined view from session (e.g. after returning from Store Preview)
  useEffect(() => {
    if (items.length === 0) return;
    try {
      const raw = sessionStorage.getItem(SMART_SHOPPING_LIST_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || !("purchase_items" in parsed)) return;
      const data = parsed as RefineResponse;
      if (!Array.isArray(data.purchase_items) || !Array.isArray(data.likely_pantry) || !Array.isArray(data.remove)) return;
      setRefinedData(data);
    } catch {
      // ignore invalid stored data
    }
  }, [items.length]);

  const grouped = useMemo(() => groupByCategory(items), [items]);

  function setWeek(week: string) {
    router.push(`/shopping-list?week=${week}`);
  }

  function toggleSelected(index: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(items.map((_, i) => i)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function handleCopyList() {
    if (refinedData) {
      handleCopySmartList();
      return;
    }
    const selected = items.filter((_, i) => selectedIds.has(i));
    const text = selected
      .map((item) => `${item.name} — ${item.total_quantity || ""}`.trim())
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleShopSelected() {
    const selected = refinedData
      ? refinedData.purchase_items
      : items.filter((_, i) => selectedIds.has(i));
    const query = selected
      .map((i) => ("name" in i ? (i as { name: string }).name : (i as ShoppingListItem).name))
      .filter(Boolean)
      .join(" ");
    if (query) {
      window.open(storeSearchUrl(preferredStore, query), "_blank", "noopener,noreferrer");
    }
  }

  function handleGoToStorePreview() {
    if (!refinedData) return;
    sessionStorage.setItem(STORE_PREVIEW_ITEMS_KEY, JSON.stringify(refinedData.purchase_items));
    router.push(`/store-preview?store=${preferredStore}`);
  }

  async function handlePrepareSmartList() {
    setRefineError(null);
    setRefining(true);
    try {
      const res = await fetch(`${getApiBase()}/shopping-list/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ name: i.name, quantity: i.total_quantity })),
        }),
      });
      if (!res.ok) throw new Error("Refine failed");
      const data: RefineResponse = await res.json();
      setRefinedData(data);
      sessionStorage.setItem(SMART_SHOPPING_LIST_KEY, JSON.stringify(data));
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRefining(false);
    }
  }

  function handleBackToOriginalList() {
    sessionStorage.removeItem(SMART_SHOPPING_LIST_KEY);
    setRefinedData(null);
    setRefineError(null);
  }

  function handleCopySmartList() {
    if (!refinedData) return;
    const lines = refinedData.purchase_items.map(
      (p) => `${p.name} — ${p.suggested_purchase || ""}`.trim()
    );
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const selectedCount = refinedData ? refinedData.purchase_items.length : selectedIds.size;
  const hasSelection = selectedCount > 0;

  if (loading) return <p style={mutedStyle}>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;

  return (
    <div style={pageStyle}>
      <h1 style={h1Style}>Shopping list</h1>

      <div style={weekNavStyle}>
        <button
          type="button"
          onClick={() => setWeek(prev)}
          style={navButtonStyle}
          aria-label="Previous week"
        >
          ← Prev
        </button>
        <span style={weekLabelStyle}>{formatWeekLabel(start, end)}</span>
        <button
          type="button"
          onClick={() => setWeek(next)}
          style={navButtonStyle}
          aria-label="Next week"
        >
          Next →
        </button>
      </div>

      <p style={mutedStyle}>
        Mon {start} – Sun {end}. Assign recipes in the{" "}
        <Link href={`/planner?week=${currentWeek}`} style={linkStyle}>
          Planner
        </Link>{" "}
        to build your list.
      </p>

      <div style={storeSelectorWrap}>
        <span style={storeSelectorLabel}>Preferred store</span>
        <div style={storeSelectorStyle} role="group" aria-label="Preferred store">
          {(["weee", "yami", "amazon"] as Store[]).map((store) => (
            <button
              key={store}
              type="button"
              onClick={() => setPreferredStore(store)}
              style={{
                ...storeOptionStyle,
                ...(preferredStore === store ? storeOptionActiveStyle : {}),
              }}
            >
              {STORE_LABELS[store]}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={emptyStyle}>
          <p>No ingredients yet.</p>
          <p style={emptyHintStyle}>
            Assign recipes to this week in the{" "}
            <Link href={`/planner?week=${currentWeek}`} style={linkStyle}>
              Planner
            </Link>{" "}
            to see your shopping list here.
          </p>
        </div>
      ) : (
        <>
          {refinedData ? (
            <>
              <button
                type="button"
                onClick={handleBackToOriginalList}
                style={selectLinkStyle}
              >
                ← Back to original list
              </button>
              <div style={smartSectionStyle}>
                <h2 style={smartSectionTitleStyle}>Purchase items</h2>
                <ul style={listStyle}>
                  {refinedData.purchase_items.map((p, i) => (
                    <li key={i} style={itemWrapStyle}>
                      <div style={itemRowStyle}>
                        <span style={nameStyle}>{p.name}</span>
                        {p.suggested_purchase && (
                          <span style={suggestedPurchaseStyle}>{p.suggested_purchase}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              {refinedData.likely_pantry.length > 0 && (
                <div style={smartSectionMutedStyle}>
                  <button
                    type="button"
                    onClick={() => setSmartPantryCollapsed((c) => !c)}
                    style={categoryHeaderStyle}
                    aria-expanded={!smartPantryCollapsed}
                  >
                    <span style={categoryChevronStyle}>{smartPantryCollapsed ? "▶" : "▼"}</span>
                    <span style={categoryTitleStyle}>Likely pantry items</span>
                    <span style={categoryCountStyle}>{refinedData.likely_pantry.length}</span>
                  </button>
                  {!smartPantryCollapsed && (
                    <ul style={listStyle}>
                      {refinedData.likely_pantry.map((p, i) => (
                        <li key={i} style={itemWrapStyle}>
                          <div style={itemRowStyle}>
                            <span style={nameStyle}>{p.name}</span>
                            {p.reason && (
                              <span style={pantryReasonStyle}>{p.reason}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {refinedData.remove.length > 0 && (
                <div style={smartSectionMutedStyle}>
                  <button
                    type="button"
                    onClick={() => setSmartRemovedCollapsed((c) => !c)}
                    style={categoryHeaderStyle}
                    aria-expanded={!smartRemovedCollapsed}
                  >
                    <span style={categoryChevronStyle}>{smartRemovedCollapsed ? "▶" : "▼"}</span>
                    <span style={categoryTitleStyle}>Removed (not purchased)</span>
                    <span style={categoryCountStyle}>{refinedData.remove.length}</span>
                  </button>
                  {!smartRemovedCollapsed && (
                    <ul style={listStyle}>
                      {refinedData.remove.map((name, i) => (
                        <li key={i} style={itemWrapStyle}>
                          <div style={itemRowStyle}>
                            <span style={removedItemStyle}>{name}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div style={bottomActionsStickyWrap}>
                <div style={bottomActionsStyle}>
                  <button
                    type="button"
                    onClick={handleGoToStorePreview}
                    style={primaryButtonStyle}
                  >
                    Shop purchase items on {STORE_LABELS[preferredStore]}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyList}
                    style={secondaryButtonStyle}
                  >
                    {copied ? "Copied!" : "Copy list"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={selectActionsStyle}>
                <button type="button" onClick={selectAll} style={selectLinkStyle}>
                  Select all
                </button>
                <span style={selectDividerStyle}>·</span>
                <button type="button" onClick={deselectAll} style={selectLinkStyle}>
                  Deselect all
                </button>
                <span style={selectDividerStyle}>·</span>
                <button
                  type="button"
                  onClick={handlePrepareSmartList}
                  disabled={refining}
                  style={selectLinkStyle}
                >
                  {refining ? "Preparing…" : "Prepare Smart Shopping List"}
                </button>
              </div>
              {refineError && (
                <p style={errorStyle}>{refineError}</p>
              )}
              <div style={categoryListStyle}>
            {CATEGORY_ORDER.map((cat) => {
              const group = grouped.get(cat) ?? [];
              if (group.length === 0) return null;
              const isCollapsed = collapsedCategories.has(cat);
              return (
                <div key={cat} style={categoryBlockStyle}>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    style={categoryHeaderStyle}
                    aria-expanded={!isCollapsed}
                  >
                    <span style={categoryChevronStyle}>{isCollapsed ? "▶" : "▼"}</span>
                    <span style={categoryTitleStyle}>{cat}</span>
                    <span style={categoryCountStyle}>{group.length}</span>
                  </button>
                  {!isCollapsed && (
                    <ul style={listStyle}>
                      {group.map(({ index, item }) => {
                        const checked = selectedIds.has(index);
                        return (
                          <li key={index} style={itemWrapStyle}>
                            <label style={itemRowStyle}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelected(index)}
                                style={checkboxStyle}
                              />
                              <span style={nameStyle}>{item.name}</span>
                              {item.total_quantity && (
                                <span style={qtyStyle}>{item.total_quantity}</span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
              </div>

              <div style={bottomActionsStickyWrap}>
                <div style={bottomActionsStyle}>
                  <button
                    type="button"
                    onClick={handleShopSelected}
                    disabled={!hasSelection}
                    style={primaryButtonStyle}
                  >
                    Shop selected items on {STORE_LABELS[preferredStore]}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyList}
                    disabled={!hasSelection}
                    style={secondaryButtonStyle}
                  >
                    {copied ? "Copied!" : "Copy list"}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minWidth: 0,
  paddingBottom: "var(--space-24)",
};

const linkStyle: React.CSSProperties = {
  color: "var(--accent)",
};

const h1Style: React.CSSProperties = {
  fontSize: "var(--font-title)",
  fontWeight: 600,
  marginBottom: "var(--space-12)",
};

const bottomActionsStickyWrap: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  left: 0,
  right: 0,
  marginLeft: "calc(-1 * var(--space-24))",
  marginRight: "calc(-1 * var(--space-24))",
  padding: "var(--space-12) var(--space-24)",
  background: "rgba(15, 15, 14, 0.92)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderTop: "1px solid var(--border)",
  zIndex: 10,
};

const weekNavStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-12)",
  marginBottom: "var(--space-8)",
};

const navButtonStyle: React.CSSProperties = {
  minHeight: 40,
  minWidth: 44,
  padding: "var(--space-8) var(--space-12)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  fontSize: "0.9rem",
  cursor: "pointer",
};

const weekLabelStyle: React.CSSProperties = {
  fontSize: "var(--font-body)",
  color: "var(--muted)",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
  marginBottom: "var(--space-16)",
};

const storeSelectorWrap: React.CSSProperties = {
  marginBottom: "var(--space-24)",
};

const storeSelectorLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  color: "var(--muted)",
  marginBottom: "var(--space-8)",
};

const storeSelectorStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-8)",
};

const storeOptionStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "var(--space-8) var(--space-12)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--muted)",
  fontSize: "0.9rem",
  cursor: "pointer",
};

const storeOptionActiveStyle: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--bg)",
  borderColor: "var(--accent)",
};

const selectActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-12)",
  marginBottom: "var(--space-16)",
};

const selectLinkStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0.4rem 0",
  background: "none",
  border: "none",
  color: "var(--accent)",
  fontSize: "0.9rem",
  cursor: "pointer",
};

const selectDividerStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.9rem",
};

const categoryListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-12)",
  marginBottom: "var(--space-32)",
};

const smartSectionStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  overflow: "hidden",
  marginBottom: "var(--space-24)",
};

const smartSectionMutedStyle: React.CSSProperties = {
  ...smartSectionStyle,
  background: "var(--surface-elevated)",
  boxShadow: "none",
  marginTop: "var(--space-16)",
};

const smartSectionTitleStyle: React.CSSProperties = {
  fontSize: "var(--font-section)",
  fontWeight: 500,
  margin: 0,
  padding: "var(--space-12) var(--space-16)",
  background: "var(--bg)",
  borderBottom: "1px solid var(--border)",
};

const pantryReasonStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.8rem",
  flexShrink: 0,
};

const removedItemStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontStyle: "italic",
};

const categoryBlockStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  overflow: "hidden",
};

const categoryHeaderStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "var(--space-12) var(--space-16)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-12)",
  background: "var(--bg)",
  border: "none",
  color: "var(--text)",
  fontSize: "var(--font-section)",
  fontWeight: 500,
  cursor: "pointer",
  textAlign: "left",
};

const categoryChevronStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  color: "var(--muted)",
};

const categoryTitleStyle: React.CSSProperties = {
  flex: 1,
};

const categoryCountStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.85rem",
  fontWeight: 400,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};

const itemWrapStyle: React.CSSProperties = {
  borderTop: "1px solid var(--border)",
};

const itemRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-12)",
  padding: "var(--space-12) var(--space-16)",
  minHeight: 48,
  cursor: "pointer",
};

const checkboxStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  flexShrink: 0,
  cursor: "pointer",
};

const nameStyle: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  fontWeight: 500,
  color: "var(--text-body)",
};

const qtyStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.9rem",
  flexShrink: 0,
  marginLeft: "auto",
};

const suggestedPurchaseStyle: React.CSSProperties = {
  ...qtyStyle,
  fontWeight: 500,
  color: "var(--text-body)",
};

const bottomActionsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-12)",
  maxWidth: 720,
  margin: "0 auto",
};

const primaryButtonStyle: React.CSSProperties = {
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

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "var(--space-12) var(--space-24)",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  fontSize: "0.95rem",
  cursor: "pointer",
};

const emptyStyle: React.CSSProperties = {
  padding: "var(--space-32)",
  background: "var(--surface)",
  borderRadius: "var(--radius-card)",
  border: "1px dashed var(--border)",
  color: "var(--muted)",
};

const emptyHintStyle: React.CSSProperties = {
  marginTop: "0.5rem",
  fontSize: "0.9rem",
};

const errorStyle: React.CSSProperties = {
  color: "#e57373",
};
