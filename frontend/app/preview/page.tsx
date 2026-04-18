"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "../components/RequireAuth";
import { useAuth } from "../lib/auth";
import { apiFetch } from "../lib/api";
import { isAdminUser } from "../lib/admin";

type CachedProduct = {
  name: string;
  price: string;
  image: string;
  url: string;
};

type CachePreviewEntry = {
  query: string;
  store: string;
  language: string;
  updated_at: string | null;
  is_warm_query: boolean;
  data: CachedProduct[];
};

type CachePreviewResponse = {
  items: CachePreviewEntry[];
  total_cached_queries: number;
  total_matching_queries: number;
  total_cached_warm_queries: number;
  total_cached_extra_queries: number;
  total_matching_warm_queries: number;
  total_matching_extra_queries: number;
  total_cached_products: number;
  total_warm_queries: number;
  ttl_seconds: number;
  limit: number;
  offset: number;
  stale_only: boolean;
};

type CacheRefreshStatus = {
  running: boolean;
  current: number;
  total: number;
  last_query: string;
  last_status: string;
  stale_only: boolean;
  summary?: {
    cache_hit?: number;
    cache_miss?: number;
    skipped?: number;
    total?: number;
  } | null;
};

const DEFAULT_PREVIEW: CachePreviewResponse = {
  items: [],
  total_cached_queries: 0,
  total_matching_queries: 0,
  total_cached_warm_queries: 0,
  total_cached_extra_queries: 0,
  total_matching_warm_queries: 0,
  total_matching_extra_queries: 0,
  total_cached_products: 0,
  total_warm_queries: 0,
  ttl_seconds: 24 * 60 * 60,
  limit: 250,
  offset: 0,
  stale_only: false,
};

function rowKey(entry: Pick<CachePreviewEntry, "query" | "store" | "language">): string {
  return `${entry.query}::${entry.store}::${entry.language}`;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelativeTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (Math.abs(diffMinutes) < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function storeLabel(store: string): string {
  return store === "weee" ? "Weee" : store === "amazon" ? "Amazon" : store;
}

function isStaleUpdatedAt(value: string | null, ttlMs: number): boolean {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() > ttlMs;
}

function ProductInline({ product }: { product: CachedProduct }) {
  return (
    <a href={product.url} target="_blank" rel="noreferrer" style={productInlineStyle}>
      {product.image ? (
        <img src={product.image} alt={product.name} style={productThumbStyle} />
      ) : (
        <div style={productFallbackStyle}>No image</div>
      )}
      <div style={productTextWrapStyle}>
        <p className="font-headline" style={productNameStyle}>
          {product.name}
        </p>
        <p style={productMetaStyle}>{product.price || "Price unavailable"}</p>
      </div>
    </a>
  );
}

function PreviewPageContent() {
  const { user, loading } = useAuth();
  const [preview, setPreview] = useState<CachePreviewResponse>(DEFAULT_PREVIEW);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [refreshingOne, setRefreshingOne] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<CacheRefreshStatus | null>(null);
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alphabetical">("newest");
  const [pageSize, setPageSize] = useState(250);
  const [offset, setOffset] = useState(0);
  const [refreshStaleOnly, setRefreshStaleOnly] = useState(true);
  const [showStaleOnly, setShowStaleOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const lastFinishedRun = useRef<string | null>(null);
  const wasRefreshRunning = useRef(false);

  const isAdmin = isAdminUser(user);

  const loadEntries = useCallback(async (nextOffset = offset, nextLimit = pageSize, nextShowStaleOnly = showStaleOnly) => {
    setLoadingEntries(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(nextLimit),
        offset: String(nextOffset),
        stale_only: nextShowStaleOnly ? "true" : "false",
      });
      const res = await apiFetch(`/admin/cache-preview?${params.toString()}`);
      if (res.status === 403) {
        setError("Admin access required.");
        setPreview(DEFAULT_PREVIEW);
        return;
      }
      if (!res.ok) throw new Error("Failed to load cache preview");
      const data = (await res.json()) as CachePreviewResponse;
      setPreview({
        items: Array.isArray(data.items) ? data.items : [],
        total_cached_queries: data.total_cached_queries ?? 0,
        total_matching_queries: data.total_matching_queries ?? 0,
        total_cached_warm_queries: data.total_cached_warm_queries ?? 0,
        total_cached_extra_queries: data.total_cached_extra_queries ?? 0,
        total_matching_warm_queries: data.total_matching_warm_queries ?? 0,
        total_matching_extra_queries: data.total_matching_extra_queries ?? 0,
        total_cached_products: data.total_cached_products ?? 0,
        total_warm_queries: data.total_warm_queries ?? 0,
        ttl_seconds: data.ttl_seconds ?? DEFAULT_PREVIEW.ttl_seconds,
        limit: data.limit ?? nextLimit,
        offset: data.offset ?? nextOffset,
        stale_only: data.stale_only ?? nextShowStaleOnly,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cache preview");
      setPreview(DEFAULT_PREVIEW);
    } finally {
      setLoadingEntries(false);
    }
  }, [offset, pageSize, showStaleOnly]);

  const loadRefreshStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/admin/cache-refresh-status");
      if (!res.ok) return;
      const data = (await res.json()) as CacheRefreshStatus;
      setRefreshStatus(data);
    } catch {
      // Status polling is best-effort.
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!isAdmin) {
      setLoadingEntries(false);
      return;
    }
    void loadEntries(offset, pageSize, showStaleOnly);
    void loadRefreshStatus();
  }, [isAdmin, loadEntries, loadRefreshStatus, loading, offset, pageSize, showStaleOnly]);

  useEffect(() => {
    if (!refreshStatus?.running) return;
    const timer = window.setInterval(() => {
      void loadRefreshStatus();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loadRefreshStatus, refreshStatus?.running]);

  useEffect(() => {
    if (refreshStatus?.running) {
      wasRefreshRunning.current = true;
      return;
    }
    if (!refreshStatus?.summary) return;
    if (!wasRefreshRunning.current) return;
    const runKey = JSON.stringify(refreshStatus.summary);
    if (lastFinishedRun.current === runKey) return;
    lastFinishedRun.current = runKey;
    wasRefreshRunning.current = false;
    void loadEntries(offset, pageSize, showStaleOnly);
    setSuccess(
      `Cache refresh finished. Hits: ${refreshStatus.summary.cache_hit ?? 0}, scraped: ${
        refreshStatus.summary.cache_miss ?? 0
      }, skipped: ${refreshStatus.summary.skipped ?? 0}.`
    );
  }, [loadEntries, offset, pageSize, refreshStatus, showStaleOnly]);

  const filteredEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const next = preview.items.filter((entry) => {
      if (storeFilter !== "all" && entry.store !== storeFilter) return false;
      if (languageFilter !== "all" && entry.language.toLowerCase() !== languageFilter) return false;
      if (!normalizedSearch) return true;
      return entry.query.toLowerCase().includes(normalizedSearch);
    });
    next.sort((a, b) => {
      if (sortBy === "alphabetical") {
        return a.query.localeCompare(b.query) || a.store.localeCompare(b.store);
      }
      if (sortBy === "oldest") {
        return (a.updated_at ?? "").localeCompare(b.updated_at ?? "") || a.query.localeCompare(b.query);
      }
      return (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.query.localeCompare(b.query);
    });
    return next;
  }, [languageFilter, preview.items, search, sortBy, storeFilter]);

  const visibleProducts = useMemo(
    () => filteredEntries.reduce((sum, entry) => sum + entry.data.length, 0),
    [filteredEntries]
  );
  const cacheTtlMs = preview.ttl_seconds * 1000;

  const totalPages = Math.max(1, Math.ceil(preview.total_matching_queries / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  const handleRefreshAll = useCallback(async () => {
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch("/admin/cache-refresh", {
        method: "POST",
        body: JSON.stringify({ stale_only: refreshStaleOnly }),
      });
      if (res.status === 403) throw new Error("Admin access required.");
      if (!res.ok) throw new Error("Failed to refresh cache");
      const payload = (await res.json()) as { started: boolean; status: CacheRefreshStatus };
      setRefreshStatus(payload.status);
      setSuccess(payload.started ? "Cache refresh started." : "A cache refresh is already running.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh cache");
    }
  }, [refreshStaleOnly]);

  const handleRefreshOne = useCallback(async (entry: CachePreviewEntry) => {
    const key = rowKey(entry);
    setRefreshingOne(key);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch("/admin/cache-refresh-one", {
        method: "POST",
        body: JSON.stringify({ query: entry.query, store: entry.store }),
      });
      if (res.status === 403) throw new Error("Admin access required.");
      if (!res.ok) throw new Error("Failed to refresh query");
      const updated = (await res.json()) as CachePreviewEntry;
      setPreview((prev) => ({
        ...prev,
        items: prev.items.map((row) => (rowKey(row) === key ? updated : row)),
      }));
      setSuccess(`Refreshed ${entry.query}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh query");
    } finally {
      setRefreshingOne(null);
    }
  }, []);

  if (loading || loadingEntries) {
    return <div style={pageStateStyle}>Loading cache preview…</div>;
  }

  if (!isAdmin) {
    return (
      <div style={pageWrapStyle}>
        <section style={panelStyle}>
          <h1 className="font-headline" style={titleStyle}>
            Preview
          </h1>
          <p style={mutedStyle}>This page is only available to the admin account.</p>
        </section>
      </div>
    );
  }

  return (
    <div style={pageWrapStyle}>
      <section style={heroStyle}>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <p style={eyebrowStyle}>Admin tools</p>
          <h1 className="font-headline" style={titleStyle}>
            Cache Preview
          </h1>
          <p style={mutedStyle}>
            {preview.total_cached_warm_queries} warm-set cached queries out of {preview.total_warm_queries} configured
            warm queries.
          </p>
          <p style={mutedStyle}>{preview.total_cached_extra_queries} extra cached queries came from ad hoc searches.</p>
          <p style={mutedStyle}>Cache TTL: {Math.round(preview.ttl_seconds / 3600)} hours</p>
          <p style={mutedStyle}>
            Showing {filteredEntries.length} of {preview.total_matching_queries} matching cached queries in this page
            view: {preview.total_matching_warm_queries} warm-set and {preview.total_matching_extra_queries} extra.
            There are {visibleProducts} cached products on this page.
          </p>
          {showStaleOnly ? <p style={mutedStyle}>Showing only entries older than 24 hours.</p> : null}
          {refreshStatus ? (
            <p style={mutedStyle}>
              {refreshStatus.running
                ? `Refreshing ${refreshStatus.current} / ${refreshStatus.total}... ${refreshStatus.last_query || ""}`
                : refreshStatus.summary
                  ? `Last run: hits ${refreshStatus.summary.cache_hit ?? 0}, scraped ${
                      refreshStatus.summary.cache_miss ?? 0
                    }, skipped ${refreshStatus.summary.skipped ?? 0}.`
                  : "No refresh running."}
            </p>
          ) : null}
        </div>
        <div style={heroActionsStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={refreshStaleOnly}
              onChange={(event) => setRefreshStaleOnly(event.target.checked)}
              disabled={refreshStatus?.running}
            />
            Only refresh stale (&gt;24h)
          </label>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={showStaleOnly}
              onChange={(event) => {
                const nextChecked = event.target.checked;
                setShowStaleOnly(nextChecked);
                setOffset(0);
              }}
            />
            Show stale only
          </label>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={refreshStatus?.running}
            className="font-headline"
            style={primaryButtonStyle}
          >
            {refreshStatus?.running ? "Refresh running..." : "Refresh All Cache"}
          </button>
        </div>
      </section>

      <section style={controlsStyle}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search query"
          style={inputStyle}
        />
        <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} style={selectStyle}>
          <option value="all">All stores</option>
          <option value="weee">Weee</option>
          <option value="amazon">Amazon</option>
        </select>
        <select
          value={languageFilter}
          onChange={(event) => setLanguageFilter(event.target.value)}
          style={selectStyle}
        >
          <option value="all">All languages</option>
          <option value="en">EN</option>
          <option value="zh">ZH</option>
        </select>
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as "newest" | "oldest" | "alphabetical")}
          style={selectStyle}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="alphabetical">Alphabetical</option>
        </select>
        <select
          value={String(pageSize)}
          onChange={(event) => {
            const next = Number(event.target.value);
            setPageSize(next);
            setOffset(0);
          }}
          style={selectStyle}
        >
          <option value="100">100 rows</option>
          <option value="250">250 rows</option>
          <option value="500">All rows</option>
        </select>
      </section>

      {error ? <div style={errorStyle}>{error}</div> : null}
      {success ? <div style={successStyle}>{success}</div> : null}

      {filteredEntries.length === 0 ? (
        <section style={panelStyle}>
          <p style={mutedStyle}>No cached queries match the current view.</p>
        </section>
      ) : (
        <section style={tableWrapStyle}>
          <div style={tableHeaderStyle}>
            <span>Query</span>
            <span>Store</span>
            <span>Lang</span>
            <span>Updated</span>
            <span>Products</span>
            <span>Actions</span>
          </div>
          <div style={tableBodyStyle}>
            {filteredEntries.map((entry) => {
              const key = rowKey(entry);
              const isRefreshing = refreshingOne === key;
              const isStale = isStaleUpdatedAt(entry.updated_at, cacheTtlMs);
              return (
                <div key={key} style={{ ...tableRowStyle, ...(isStale ? staleRowStyle : null) }}>
                  <div style={queryCellStyle}>
                    <div style={queryHeadStyle}>
                      <p className="font-headline" style={queryTitleStyle}>
                        {entry.query}
                      </p>
                      <span style={entry.is_warm_query ? warmBadgeStyle : extraBadgeStyle}>
                        {entry.is_warm_query ? "WARM" : "EXTRA"}
                      </span>
                      {isStale ? <span style={staleBadgeStyle}>STALE</span> : null}
                    </div>
                  </div>
                  <div style={metaCellStyle}>{storeLabel(entry.store)}</div>
                  <div style={metaCellStyle}>{entry.language.toUpperCase()}</div>
                  <div style={updatedCellStyle}>
                    <span>{formatUpdatedAt(entry.updated_at)}</span>
                    <span style={mutedSmallStyle}>{formatRelativeTime(entry.updated_at)}</span>
                  </div>
                  <div
                    style={{
                      ...productsCellStyle,
                      gridTemplateColumns: `repeat(${Math.min(3, entry.data.length)}, minmax(120px, 1fr))`,
                    }}
                  >
                    {entry.data.map((product) => (
                      <ProductInline key={`${key}-${product.url}`} product={product} />
                    ))}
                  </div>
                  <div style={actionsCellStyle}>
                    <button
                      type="button"
                      onClick={() => void handleRefreshOne(entry)}
                      disabled={isRefreshing || !!refreshStatus?.running}
                      className="font-headline"
                      style={secondaryButtonStyle}
                    >
                      {isRefreshing ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={paginationStyle}>
            <span style={mutedStyle}>
              Page {currentPage} of {totalPages}
            </span>
            <div style={rowActionsStyle}>
              <button
                type="button"
                onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
                disabled={offset === 0}
                style={ghostButtonStyle}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  setOffset((current) =>
                    current + pageSize >= preview.total_matching_queries ? current : current + pageSize
                  )
                }
                disabled={offset + pageSize >= preview.total_matching_queries}
                style={ghostButtonStyle}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default function PreviewPage() {
  return (
    <RequireAuth>
      <PreviewPageContent />
    </RequireAuth>
  );
}

const pageWrapStyle: CSSProperties = {
  padding: "var(--space-32)",
  display: "grid",
  gap: "var(--space-20)",
};

const pageStateStyle: CSSProperties = {
  padding: "var(--space-32)",
  color: "var(--muted)",
  textAlign: "center",
};

const heroStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-16)",
  justifyContent: "space-between",
  alignItems: "flex-start",
  flexWrap: "wrap",
  padding: "var(--space-24)",
  borderRadius: "var(--radius-card)",
  background: "var(--surface-container-low)",
};

const heroActionsStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-10)",
  justifyItems: "end",
};

const panelStyle: CSSProperties = {
  padding: "var(--space-20)",
  borderRadius: "var(--radius-card)",
  background: "var(--surface-container-low)",
  display: "grid",
  gap: "var(--space-16)",
};

const controlsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "var(--space-12)",
  padding: "var(--space-16)",
  borderRadius: "var(--radius-card)",
  background: "var(--surface-container-low)",
};

const tableWrapStyle: CSSProperties = {
  borderRadius: "var(--radius-card)",
  background: "var(--surface-container-low)",
  overflow: "hidden",
};

const tableHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1.3fr) 90px 70px 170px minmax(360px, 2fr) 110px",
  gap: "var(--space-12)",
  padding: "0.9rem 1rem",
  borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 35%, transparent)",
  color: "var(--on-surface-variant)",
  fontSize: "0.82rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const tableBodyStyle: CSSProperties = {
  display: "grid",
};

const tableRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1.3fr) 90px 70px 170px minmax(360px, 2fr) 110px",
  gap: "var(--space-12)",
  padding: "0.9rem 1rem",
  alignItems: "center",
  borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 18%, transparent)",
};

const staleRowStyle: CSSProperties = {
  background: "color-mix(in srgb, var(--surface-container-high) 72%, rgba(255, 152, 0, 0.08))",
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: "var(--on-surface-variant)",
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontWeight: 800,
};

const titleStyle: CSSProperties = {
  margin: "0.25rem 0",
  fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
};

const mutedStyle: CSSProperties = {
  margin: 0,
  color: "var(--on-surface-variant)",
};

const mutedSmallStyle: CSSProperties = {
  color: "var(--on-surface-variant)",
  fontSize: "0.8rem",
};

const errorStyle: CSSProperties = {
  ...panelStyle,
  color: "var(--error)",
};

const successStyle: CSSProperties = {
  ...panelStyle,
  color: "var(--primary)",
};

const rowActionsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-8)",
  alignItems: "center",
  flexWrap: "wrap",
};

const buttonBaseStyle: CSSProperties = {
  border: "none",
  borderRadius: "var(--radius-md)",
  padding: "0.7rem 0.95rem",
  cursor: "pointer",
  fontSize: "0.9rem",
  fontWeight: 700,
};

const primaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: "var(--primary-gradient)",
  color: "#fff",
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: "var(--surface-container-high)",
  color: "var(--on-surface)",
};

const ghostButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: "transparent",
  color: "var(--primary)",
  boxShadow: "0 0 0 1px color-mix(in srgb, var(--outline-variant) 35%, transparent)",
};

const inputStyle: CSSProperties = {
  padding: "0.8rem 0.95rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid color-mix(in srgb, var(--outline-variant) 45%, transparent)",
  background: "var(--surface-container-high)",
  color: "var(--on-surface)",
};

const selectStyle: CSSProperties = inputStyle;

const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  gap: "0.55rem",
  alignItems: "center",
  color: "var(--on-surface-variant)",
  fontSize: "0.92rem",
};

const queryCellStyle: CSSProperties = {
  minWidth: 0,
};

const queryHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
  minWidth: 0,
  flexWrap: "wrap",
};

const queryTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const staleBadgeStyle: CSSProperties = {
  padding: "0.12rem 0.42rem",
  borderRadius: "999px",
  background: "rgba(255, 152, 0, 0.14)",
  color: "#b86400",
  fontSize: "0.72rem",
  fontWeight: 800,
  letterSpacing: "0.06em",
};

const warmBadgeStyle: CSSProperties = {
  padding: "0.12rem 0.42rem",
  borderRadius: "999px",
  background: "rgba(76, 175, 80, 0.14)",
  color: "#2e7d32",
  fontSize: "0.72rem",
  fontWeight: 800,
  letterSpacing: "0.06em",
};

const extraBadgeStyle: CSSProperties = {
  padding: "0.12rem 0.42rem",
  borderRadius: "999px",
  background: "rgba(33, 150, 243, 0.12)",
  color: "#1565c0",
  fontSize: "0.72rem",
  fontWeight: 800,
  letterSpacing: "0.06em",
};

const metaCellStyle: CSSProperties = {
  color: "var(--on-surface-variant)",
  fontSize: "0.92rem",
};

const updatedCellStyle: CSSProperties = {
  display: "grid",
  gap: "0.2rem",
  fontSize: "0.9rem",
};

const productsCellStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-10)",
  minWidth: 0,
};

const actionsCellStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const productInlineStyle: CSSProperties = {
  minWidth: "120px",
  display: "grid",
  gridTemplateColumns: "56px 1fr",
  gap: "0.55rem",
  alignItems: "center",
  padding: "0.4rem",
  borderRadius: "var(--radius-md)",
  background: "var(--surface-container-high)",
  textDecoration: "none",
  color: "inherit",
};

const productThumbStyle: CSSProperties = {
  width: "56px",
  height: "56px",
  objectFit: "cover",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface-container)",
};

const productFallbackStyle: CSSProperties = {
  ...productThumbStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--on-surface-variant)",
  fontSize: "0.75rem",
  textAlign: "center",
};

const productTextWrapStyle: CSSProperties = {
  minWidth: 0,
};

const productNameStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.88rem",
  lineHeight: 1.25,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};

const productMetaStyle: CSSProperties = {
  margin: "0.25rem 0 0",
  color: "var(--on-surface-variant)",
  fontSize: "0.78rem",
};

const paginationStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--space-12)",
  padding: "1rem",
};
