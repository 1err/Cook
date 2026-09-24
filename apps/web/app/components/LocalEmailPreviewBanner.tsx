import styles from "./LocalEmailPreviewBanner.module.css";

export function LocalEmailPreviewBanner() {
  if (process.env.NEXT_PUBLIC_LOCAL_EMAIL_PREVIEW !== "1") return null;

  let api: URL;
  try {
    api = new URL(process.env.NEXT_PUBLIC_API_BASE ?? "");
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(api.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(api.hostname)
    || api.username || api.password || api.search || api.hash) return null;

  const inboxUrl = `${api.origin}${api.pathname.replace(/\/+$/, "")}/__preview/inbox`;
  return <aside className={styles.banner} aria-label="Local test environment">
    <p><strong>Local test environment.</strong> Accounts stay on this computer. Emails appear in the test inbox, not your real inbox.</p>
    <a href={inboxUrl}>Open test inbox</a>
  </aside>;
}
