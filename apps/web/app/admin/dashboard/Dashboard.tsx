"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { AudienceChart, BreakdownTable, Funnel } from "./Charts";
import { UserDialog, UserTable } from "./UserDirectory";
import type { Account, Detail, Overview, UsersPage } from "./types";
import { dateLabel, eventLabel } from "./types";
import styles from "./Dashboard.module.css";

const tabs = ["Overview", "Users", "Acquisition", "Engagement"] as const;
type Tab = (typeof tabs)[number];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [preset, setPreset] = useState("30");
  const [start, setStart] = useState(() => daysAgo(29));
  const [end, setEnd] = useState(today);
  const [internal, setInternal] = useState(false);
  const [data, setData] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UsersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Account | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const selection = useRef(0);
  const parameters = new URLSearchParams({
    start,
    end,
    include_internal: String(internal),
  }).toString();
  const effectiveSearch = tab === "Users" ? search : "";
  const effectiveOffset = tab === "Users" ? offset : 0;
  useEffect(() => {
    selection.current++;
    setSelected(null);
  }, [parameters]);
  const rangeValid =
    !!start && !!end && end <= today() && start <= end &&
    new Date(end).getTime() - new Date(start).getTime() < 90 * 86400000;
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!rangeValid) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      apiFetch(`/admin/analytics/overview?${parameters}`, {
        signal: abort.signal,
        cache: "no-store",
      }),
      apiFetch(
        `/admin/analytics/users?${parameters}&q=${encodeURIComponent(effectiveSearch)}&limit=25&offset=${effectiveOffset}`,
        { signal: abort.signal, cache: "no-store" },
      ),
    ])
      .then(async ([a, b]) => {
        if (!a.ok || !b.ok)
          throw new Error(
            "We could not load your dashboard. Please try again.",
          );
        const [overview, accounts] = await Promise.all([a.json(), b.json()]);
        if (!abort.signal.aborted) {
          setData(overview);
          setUsers(accounts);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setError(e.message || "We could not load your dashboard.");
          setData(null);
          setUsers(null);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [parameters, effectiveSearch, effectiveOffset, reload, rangeValid]);
  const openUser = useCallback(
    async (user: Account) => {
      const generation = ++selection.current;
      setSelected(user);
      setDetail(null);
      setDetailError("");
      try {
        const res = await apiFetch(
          `/admin/analytics/users/${user.id}?${parameters}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error();
        const value = await res.json();
        if (generation === selection.current) setDetail(value);
      } catch {
        if (generation === selection.current)
          setDetailError("We could not load this account’s activity.");
      }
    },
    [parameters],
  );
  async function setTest(value: boolean) {
    if (!selected) return;
    const generation = selection.current;
    setSaving(true);
    setDetailError("");
    try {
      const r = await apiFetch(
        `/admin/analytics/users/${selected.id}/test-status`,
        { method: "PATCH", body: JSON.stringify({ is_test: value }) },
      );
      if (!r.ok) throw new Error();
      setReload((x) => x + 1);
      if (generation === selection.current) await openUser({ ...selected, is_test: value });
    } catch {
      if (generation === selection.current) setDetailError("We could not update this account. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  async function exportUsers() {
    setExporting(true);
    setError("");
    try {
      const r = await apiFetch(
        `/admin/analytics/users.csv?${parameters}&q=${encodeURIComponent(search)}`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "chef-world-users.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(
        "We could not export these accounts. Narrow your search or try again.",
      );
    } finally {
      setExporting(false);
    }
  }
  const changePreset = (value: string) => {
    setPreset(value);
    setOffset(0);
    if (value !== "custom") {
      setStart(daysAgo(Number(value) - 1));
      setEnd(today());
    }
  };
  const total = data?.totals;
  const metric = (key: string) => data?.coverage.unavailable && !["total_users", "new_users"].includes(key) ? "—" : (total?.[key] || 0).toLocaleString();
  const trend = (key: string) => {
    if (!data?.coverage.previous_complete)
      return "Comparable history is not available yet";
    const old = data.previous[key] || 0;
    const value = data.totals[key] || 0;
    return old
      ? `${value >= old ? "+" : ""}${Math.round(((value - old) / old) * 100)}% vs. previous period`
      : value
        ? "New activity this period"
        : "No change from previous period";
  };
  return (
    <main className={styles.dashboard}>
      <header className={styles.heading}>
        <div>
          <h1>Growth dashboard</h1>
          <p>Understand who arrives, what they do, and who comes back.</p>
        </div>
        <div className={styles.controls}>
          <label className={styles.srOnly} htmlFor="report-range">
            Date range
          </label>
          <select
            id="report-range"
            className={styles.button}
            value={preset}
            onChange={(e) => changePreset(e.target.value)}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom dates</option>
          </select>
          <button
            className={`${styles.button} ${styles.primary}`}
            disabled={loading || !rangeValid}
            onClick={() => setReload((x) => x + 1)}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      {preset === "custom" && (
        <div className={styles.customDates}>
          <label>
            From
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={end}
              min={start}
              max={today()}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          {!rangeValid && <p role="alert">Choose a range of 1–90 days.</p>}
        </div>
      )}
      <div className={styles.tabs} role="tablist" aria-label="Dashboard views">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-controls="dashboard-panel"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const next =
                  tabs[
                    (tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : 3)) % 4
                  ];
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button
            className={styles.textButton}
            onClick={() => setReload((x) => x + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {!data && loading && (
        <div className={styles.loading} role="status">
          Gathering your audience insights…
        </div>
      )}
      {data && total && users && (
        <>
          <div className={styles.reporting}>
            <p className={styles.notice}>
              Tracking started {dateLabel(data.tracking_started_at)}.{" "}
              {data.coverage.partial
                ? "Earlier activity in this range is not available."
                : "This range is covered by tracking."}
            </p>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              Include internal activity
            </label>
          </div>
          {Boolean(data.collection?.failures_since_process_start) && (
            <p className={styles.notice} role="status">Some activity could not be recorded. Totals may be incomplete. Last collection issue: {dateLabel(data.collection?.last_failure_at || null)}.</p>
          )}
          {data.coverage.unavailable && (
            <p className={styles.notice}>Activity tracking is unavailable for this entire period. Account registrations remain available.</p>
          )}
          <section
            id="dashboard-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            aria-busy={loading}
          >
            {tab === "Overview" && (
              <>
                <div className={styles.metrics}>
                  {[
                    [
                      "Total users",
                      "total_users",
                      `Includes ${total.internal_users} internal ${total.internal_users === 1 ? "account" : "accounts"}`,
                    ],
                    [
                      "New users",
                      "new_users",
                      internal
                        ? "All accounts included"
                        : "Internal accounts excluded",
                    ],
                    ["Active users", "active_users", "Meaningful app activity"],
                    ["Website visitors", "visitors", "Observed browsers"],
                  ].map(([label, key, caption]) => (
                    <div key={key}>
                      <p>{label}</p>
                      <strong>{metric(key)}</strong>
                      <span>{caption}</span>
                      {key !== "total_users" && <small>{trend(key)}</small>}
                    </div>
                  ))}
                </div>
                <div className={styles.primaryGrid}>
                  <section className={styles.panel}>
                    <div className={styles.sectionHeader}>
                      <div>
                        <h2>Audience over time</h2>
                        <p>Visitors and new users, by day.</p>
                      </div>
                      <div className={styles.legend}>
                        <span>Website visitors</span>
                        <span>New users</span>
                      </div>
                    </div>
                    <AudienceChart days={data.series} />
                  </section>
                  <section className={styles.panel}>
                    <h2>From signup to first meal</h2>
                    <p>Actions within seven days of registration.</p>
                    <Funnel data={data.engagement.funnel} />
                  </section>
                </div>
                <section className={styles.recent}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2>Recent registrations</h2>
                      <p>Latest accounts to join Chef World.</p>
                    </div>
                    <button
                      className={styles.textButton}
                      onClick={() => setTab("Users")}
                    >
                      View all users →
                    </button>
                  </div>
                  <UserTable
                    items={users.items.slice(0, 5)}
                    onSelect={openUser}
                  />
                </section>
                <div className={styles.secondaryMetrics}>
                  <div>
                    <strong>{metric("logins")}</strong>
                    <span>Successful logins</span>
                  </div>
                  <div>
                    <strong>{metric("unique_logins")}</strong>
                    <span>Accounts logging in</span>
                  </div>
                  <div>
                    <strong>
                      {data.coverage.unavailable ? "—" : `${data.active.daily} / ${data.active.weekly} / ${data.active.monthly}`}
                    </strong>
                    <span>Daily / weekly / monthly active</span>
                  </div>
                  <div>
                    <strong>{metric("visits")}</strong>
                    <span>Website visits</span>
                  </div>
                </div>
              </>
            )}
            {tab === "Users" && (
              <section className={styles.recent}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2>Your community</h2>
                    <p>
                      {users.total.toLocaleString()} accounts · All roles
                      included. Login counts use the selected period.
                    </p>
                  </div>
                  <button
                    className={styles.button}
                    onClick={exportUsers}
                    disabled={exporting}
                  >
                    {exporting ? "Exporting…" : "Export CSV"}
                  </button>
                </div>
                <label className={styles.search}>
                  Search accounts
                  <input
                    type="search"
                    placeholder="Search by email"
                    maxLength={128}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <UserTable items={users.items} onSelect={openUser} />
                <div className={styles.pagination}>
                  <span>
                    {users.total
                      ? `${offset + 1}–${Math.min(offset + 25, users.total)} of ${users.total}`
                      : "0 accounts"}
                  </span>
                  <button
                    className={styles.button}
                    disabled={offset === 0 || loading}
                    onClick={() => setOffset(Math.max(0, offset - 25))}
                  >
                    Previous
                  </button>
                  <button
                    className={styles.button}
                    disabled={offset + 25 >= users.total || loading}
                    onClick={() => setOffset(offset + 25)}
                  >
                    Next
                  </button>
                </div>
              </section>
            )}
            {tab === "Acquisition" && (
              <>
                <div className={styles.metrics}>
                  <div>
                    <p>Website visitors</p>
                    <strong>{metric("visitors")}</strong>
                    <span>Observed browsers</span>
                  </div>
                  <div>
                    <p>Visits</p>
                    <strong>{metric("visits")}</strong>
                    <span>30-minute activity sessions</span>
                  </div>
                  <div>
                    <p>Visitor → signup</p>
                    <strong>
                      {data.acquisition.signup_conversion === null
                        ? "—"
                        : `${data.acquisition.signup_conversion}%`}
                    </strong>
                    <span>Linked, observed visitors only</span>
                  </div>
                  <div>
                    <p>Unattributed signups</p>
                    <strong>{data.coverage.unavailable ? "—" : data.acquisition.unattributed_signups}</strong>
                    <span>No browser attribution available</span>
                  </div>
                </div>
                <div className={styles.twoColumns}>
                  <BreakdownTable
                    title="Traffic sources"
                    items={data.acquisition.sources}
                  />
                  <BreakdownTable title="Landing pages" items={data.acquisition.landing_pages || []} measure="views" />
                  <BreakdownTable
                    title="Popular pages"
                    items={data.acquisition.pages}
                    measure="views"
                  />
                  <BreakdownTable
                    title="Campaigns"
                    items={data.acquisition.campaigns}
                  />
                  <BreakdownTable
                    title="Devices"
                    items={data.acquisition.devices}
                  />
                  <BreakdownTable
                    title="Browsers"
                    items={data.acquisition.browsers}
                  />
                </div>
                <p className={styles.footnote}>
                  Anonymous visitors are browsers, not identified people.
                  Privacy choices, blockers, shared devices, and bots can affect
                  observed traffic.
                </p>
              </>
            )}
            {tab === "Engagement" && (
              <>
                <div className={styles.primaryGrid}>
                  <section className={styles.panel}>
                    <h2>What people do</h2>
                    <p>Successful product actions in the selected period.</p>
                    {data.engagement.events.length ? (
                      <div className={styles.tableScroll}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Action</th>
                              <th>Events</th>
                              <th>Accounts</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.engagement.events.map((e) => (
                              <tr key={e.name}>
                                <td>{eventLabel(e.name)}</td>
                                <td>{e.count}</td>
                                <td>{e.users}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className={styles.empty}>
                        Product activity will appear as your community starts
                        cooking.
                      </p>
                    )}
                  </section>
                  <section className={styles.panel}>
                    <h2>First-week activation</h2>
                    <p>
                      {data.engagement.funnel.signed_up} new accounts observed
                      since tracking began.
                    </p>
                    <Funnel data={data.engagement.funnel} />
                    <p className={styles.footnote}>
                      {data.engagement.funnel.mature_users} accounts have had a
                      full seven days to activate.
                    </p>
                  </section>
                </div>
                <section className={styles.recent}>
                  <h2>Who comes back</h2>
                  <p>
                    Meaningful activity by signup week. Unfinished weeks appear
                    as a dash.
                  </p>
                  {data.engagement.cohorts.length ? (
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Signup week</th>
                            <th>Accounts</th>
                            {[0, 1, 2, 3, 4].map((w) => (
                              <th key={w}>Week {w}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.engagement.cohorts.map((c) => (
                            <tr key={c.week}>
                              <td>{dateLabel(c.week)}</td>
                              <td>{c.users}</td>
                              {c.weeks.map((v, i) => (
                                <td
                                  key={i}
                                  className={styles.cohortCell}
                                  style={
                                    v !== null
                                      ? {
                                          background: `rgba(104,119,97,${0.05 + v / 350})`,
                                        }
                                      : undefined
                                  }
                                >
                                  {v === null ? "—" : `${v}%`}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className={styles.empty}>
                      Retention begins with your first new users. Completed
                      weeks will appear here.
                    </p>
                  )}
                </section>
                <p className={styles.footnote}>
                  Retailer handoffs measure outbound interest. They do not
                  confirm purchases or revenue. Saved recipe and plan totals in
                  the account directory describe current inventory.
                </p>
              </>
            )}
          </section>
          <footer className={styles.footer}>
            <span>
              {internal
                ? "Internal activity included"
                : "Internal accounts excluded from traction metrics"}
            </span>
            <span>
              Reporting timezone: UTC · Updated{" "}
              {new Date(data.refreshed_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "UTC",
              })}
            </span>
          </footer>
        </>
      )}
      {selected && (
        <UserDialog
          account={selected}
          detail={detail}
          error={detailError}
          onClose={() => {
            selection.current++;
            setSelected(null);
          }}
          onTestChange={setTest}
          saving={saving}
        />
      )}
    </main>
  );
}
