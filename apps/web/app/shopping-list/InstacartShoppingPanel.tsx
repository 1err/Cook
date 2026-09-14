"use client";

import { useEffect, useRef, useState } from "react";
import { isSafeInstacartUrl, type InstacartItem } from "@cooking/shared";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n";
import styles from "./InstacartShoppingPanel.module.css";

type Props = {
  title: string;
  items: InstacartItem[];
  listKey: string;
  disabled?: boolean;
  stale?: boolean;
};

function failureMessage(body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = body.detail;
    if (detail && typeof detail === "object" && "code" in detail) {
      if (detail.code === "instacart_not_configured") return "shopping.instacartNotConfigured";
      if (detail.code === "instacart_rate_limited") return "shopping.instacartRateLimited";
    }
  }
  return "shopping.instacartFailed";
}

function InstacartShoppingRequest({ title, items, disabled, stale }: Omit<Props, "listKey">) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const unavailable = Boolean(disabled || stale);

  useEffect(() => () => { pending.current?.abort(); }, []);

  async function createLink() {
    if (pending.current || unavailable || items.length === 0) return;
    const controller = new AbortController();
    pending.current = controller;
    setCreating(true);
    setErrorKey(null);
    setUrl(null);

    try {
      const response = await apiFetch("/shopping-list/instacart", {
        method: "POST",
        body: JSON.stringify({ title, items }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const body: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setErrorKey(failureMessage(body));
        return;
      }
      if (
        !body || typeof body !== "object" || !("url" in body)
        || typeof body.url !== "string" || !isSafeInstacartUrl(body.url)
      ) {
        setErrorKey("shopping.instacartFailed");
        return;
      }
      setUrl(body.url);
    } catch {
      if (!controller.signal.aborted) setErrorKey("shopping.instacartFailed");
    } finally {
      if (!controller.signal.aborted && pending.current === controller) {
        pending.current = null;
        setCreating(false);
      }
    }
  }

  return (
    <section className={styles.panel} aria-label={t("shopping.instacartTitle")}>
      <div className={styles.copy}>
        <h2>{t("shopping.instacartTitle")}</h2>
        <p>{t("shopping.instacartDescription")}</p>
        <p className={styles.review}>{t("shopping.instacartReview")}</p>
      </div>
      <div className={styles.actions}>
        {url ? (
          <>
            <a className={styles.button} href={url} target="_blank" rel="noopener noreferrer">
              <img src="/instacart-logo.svg" alt="" width={22} height={22} aria-hidden="true" />
              {t("shopping.instacartOpen")}
            </a>
            <p className={styles.status} role="status">{t("shopping.instacartReady")}</p>
          </>
        ) : (
          <button
            className={styles.button}
            type="button"
            disabled={creating || unavailable || items.length === 0}
            aria-busy={creating}
            onClick={() => void createLink()}
          >
            <img src="/instacart-logo.svg" alt="" width={22} height={22} aria-hidden="true" />
            {t(creating ? "shopping.instacartCreating" : "shopping.instacartCreate")}
          </button>
        )}
        {unavailable ? (
          <p className={styles.status}>{t("shopping.instacartRefresh")}</p>
        ) : items.length === 0 ? (
          <p className={styles.status}>{t("shopping.instacartEmpty")}</p>
        ) : null}
        {errorKey ? <p className={styles.error} role="alert">{t(errorKey)}</p> : null}
      </div>
    </section>
  );
}

export function InstacartShoppingPanel({ listKey, ...props }: Props) {
  // A new source gets a fresh request lifecycle and cannot display a previous link.
  const requestKey = JSON.stringify([listKey, props.title, props.items, props.disabled, props.stale]);
  return <InstacartShoppingRequest key={requestKey} {...props} />;
}
