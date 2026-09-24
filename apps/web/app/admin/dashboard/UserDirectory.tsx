import { useEffect, useRef } from "react";
import type { Account, Detail } from "./types";
import { dateLabel, eventLabel } from "./types";
import styles from "./Dashboard.module.css";

export function UserTable({
  items,
  onSelect,
}: {
  items: Account[];
  onSelect: (u: Account) => void;
}) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Account</th>
            <th>Joined</th>
            <th>Last active</th>
            <th>Recipes</th>
            <th>Logins</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id}>
              <td>
                <button
                  className={styles.accountButton}
                  onClick={() => onSelect(u)}
                >
                  {u.email}
                </button>
                {(u.is_admin || u.is_test) && (
                  <small className={styles.accountRole}>
                    {u.is_admin ? "Administrator" : "Test account"}
                  </small>
                )}
              </td>
              <td>{dateLabel(u.created_at)}</td>
              <td className={!u.last_seen_at ? styles.muted : undefined}>
                {dateLabel(u.last_seen_at)}
              </td>
              <td>{u.recipes}</td>
              <td>{u.logins ?? "—"}{u.login_coverage === "partial" && <small className={styles.accountRole}>Partial history</small>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <p className={styles.empty}>No accounts match this search.</p>
      )}
    </div>
  );
}

export function UserDialog({
  account,
  detail,
  error,
  onClose,
  onTestChange,
  saving,
}: {
  account: Account;
  detail: Detail | null;
  error: string;
  onClose: () => void;
  onTestChange: (value: boolean) => void;
  saving: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) {
      if (el.showModal) el.showModal();
      else el.setAttribute("open", "");
    }
    return () => el?.close?.();
  }, []);
  const u = detail?.user || account;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="account-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sectionHeader}>
        <h2 id="account-title">Account activity</h2>
        <button className={styles.button} onClick={onClose}>
          Close
        </button>
      </div>
      <p className={styles.email}>{u.email}</p>
      <dl className={styles.detailGrid}>
        <div>
          <dt>Joined</dt>
          <dd>{dateLabel(u.created_at)}</dd>
        </div>
        <div>
          <dt>Last login</dt>
          <dd>{dateLabel(u.last_login_at)}</dd>
        </div>
        <div>
          <dt>Saved recipes</dt>
          <dd>{u.recipes}</dd>
        </div>
        <div>
          <dt>Meal-plan days</dt>
          <dd>{u.plan_rows}</dd>
        </div>
      </dl>
      {!u.is_admin && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={u.is_test}
            disabled={saving}
            onChange={(e) => onTestChange(e.target.checked)}
          />
          Exclude this test account from traction reports
        </label>
      )}
      {u.is_admin && (
        <p className={styles.notice}>
          Administrator activity is excluded from traction by default.
        </p>
      )}
      <h3>Recent activity</h3>
      {detail?.coverage?.partial && <p className={styles.notice}>{detail.coverage.unavailable ? "Activity tracking is unavailable for this period." : "Only part of this period has recorded activity."}</p>}
      <p className={styles.muted}>
        Up to 50 events in the selected period · UTC
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !detail ? (
        <p role="status">Loading activity…</p>
      ) : detail.events.length ? (
        <ol className={styles.timeline}>
          {detail.events.map((e, i) => (
            <li key={i}>
              <div>
                <strong>{eventLabel(e.name)}</strong>
                <span>{e.path || e.platform}</span>
              </div>
              <time>
                {new Date(e.occurred_at).toLocaleString("en-US", {
                  timeZone: "UTC",
                })}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>{detail.coverage?.unavailable ? "Historical activity is unavailable." : "No recorded activity in the tracked portion of this period."}</p>
      )}
    </dialog>
  );
}
