"use client";

import { useEffect, useRef, useState } from "react";
import { webApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import styles from "./SharingSafety.module.css";
import { useAccountScope } from "./useAccountScope";

export function BlockedAccounts() {
  const scope = useAccountScope();
  return <AccountBlockedAccounts key={scope.accountId} />;
}

function AccountBlockedAccounts() {
  const t = useT();
  const scope = useAccountScope();
  const [users, setUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef<object | null>(null);
  useEffect(() => {
    let active = true;
    const actor = scope.capture();
    setUsers([]);
    setBusyId(null);
    busyRef.current = null;
    if (!actor) { setLoading(false); return; }
    setLoading(true);
    setFailed(false);
    webApiClient.users.blockedUsers(actor.id).then((result) => { if (active && scope.active(actor)) setUsers(result.users); })
      .catch(() => { if (active && scope.active(actor)) setFailed(true); })
      .finally(() => { if (active && scope.active(actor)) setLoading(false); });
    return () => { active = false; };
  }, [refresh, scope.accountId]);
  async function unblock(userId: string) {
    const actor = scope.capture();
    if (!actor || busyRef.current || !window.confirm(`${t("safety.unblockTitle")}\n\n${t("safety.unblockBody")}`)) return;
    const operation = {};
    busyRef.current = operation;
    setBusyId(userId);
    setFailed(false);
    try {
      await webApiClient.users.unblockUser(userId, actor.id);
      if (!scope.active(actor)) return;
      setUsers((current) => current.filter((user) => user.id !== userId));
    } catch { if (scope.active(actor)) setFailed(true); }
    finally { if (busyRef.current === operation) { busyRef.current = null; setBusyId(null); } }
  }
  return <section className={styles.section} aria-label={t("safety.blockedTitle")}>
    <h2>{t("safety.blockedTitle")}</h2>
    {loading ? <p role="status">{t("common.loading")}</p> : users.length === 0 && !failed ? <p>{t("safety.blockedEmpty")}</p> : null}
    {failed ? <p role="alert" className={styles.error}>{t("safety.failed")} <button type="button" className={styles.quietButton} disabled={loading || !!busyId} onClick={() => setRefresh((value) => value + 1)}>{t("safety.retry")}</button></p> : null}
    <ul className={styles.blockedList}>
      {users.map((user) => <li key={user.id}><span>{user.email}</span><button type="button" className={styles.quietButton} disabled={!!busyId} onClick={() => void unblock(user.id)} aria-label={`${t("safety.unblock")}: ${user.email}`}>{t(busyId === user.id ? "common.saving" : "safety.unblock")}</button></li>)}
    </ul>
  </section>;
}
