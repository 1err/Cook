"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import styles from "./CostsPanel.module.css";

type InfrastructureReport = {
  status: "available" | "unavailable";
  provider: "aws";
  scope: string;
  scope_description?: string;
  month_utc: string;
  through: string;
  fetched_at: string | null;
  estimated: boolean | null;
  currency: string;
  total_usd: string | null;
  services: { service: string; cost_usd: string }[];
  unavailable_reason: string | null;
};
const money = (amount: string) => Number.isFinite(Number(amount))
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(Number(amount))
  : "Unavailable";
const day = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

export function InfrastructureCosts({ refreshToken = 0 }: { refreshToken?: number }) {
  const [data, setData] = useState<InfrastructureReport | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    void apiFetch("/admin/infrastructure-costs", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("AWS report unavailable");
        const report = await response.json() as InfrastructureReport;
        if (!controller.signal.aborted && report.status === "available" && report.currency === "USD" && report.total_usd !== null && Number.isFinite(Number(report.total_usd))) setData(report);
      })
      .catch(() => { if (!controller.signal.aborted) setData(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshToken]);

  return <section className={`${styles.costs} ${styles.infrastructure}`} aria-labelledby="infrastructure-costs">
    <header><h2 id="infrastructure-costs">Hosting &amp; infrastructure</h2><p>AWS account totals are shown separately from app AI estimates. They may cover other resources and are not added into a combined app bill.</p></header>
    {loading ? <p role="status">Loading AWS account costs…</p> : data ? <>
      <div className={styles.awsSummary}><div aria-label="AWS account estimate"><p>AWS account {data.estimated ? "estimate" : "reported cost"}</p><strong>{money(data.total_usd!)}</strong></div>
        <div><p>{data.scope_description || "AWS account-wide; includes resources outside this app."}</p><p>{day(data.month_utc)} – {day(data.through)} UTC</p>
          <p>{data.fetched_at ? `Fetched ${new Date(data.fetched_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC.` : "Fetch time unavailable."} Cached for up to 6 hours.</p>
        </div></div>
      {data.services.length ? <div className={styles.tableScroll}><table className={styles.table} aria-label="AWS account service costs">
        <thead><tr><th scope="col">AWS service</th><th scope="col">Account-wide USD</th></tr></thead>
        <tbody>{data.services.map(row => <tr key={row.service}><th scope="row">{row.service}</th><td>{money(row.cost_usd)}</td></tr>)}</tbody>
      </table></div> : null}
    </> : <p role="status">AWS cost data is unavailable.</p>}
    <p>Vercel costs are not connected. Use the provider dashboards for charges, plan fees and invoices.</p>
    <div className={styles.providerLinks}><a href="https://console.aws.amazon.com/billing/home" target="_blank" rel="noopener noreferrer">Open AWS billing</a><a href="https://vercel.com/dashboard/usage" target="_blank" rel="noopener noreferrer">Open Vercel usage &amp; billing</a></div>
  </section>;
}
