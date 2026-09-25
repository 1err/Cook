"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { AICostReport } from "./costTypes";
import styles from "./CostsPanel.module.css";

const money = (value: string) => value.trim() && Number.isFinite(Number(value))
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value))
  : "Unavailable";
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function groupLabel(group: AICostReport["groups"][number]): string {
  if (group.provider === "openai") return group.kind === "image" ? "OpenAI images" : "OpenAI text";
  if (group.provider === "google") return group.kind === "video" ? "Gemini video" : "Gemini";
  return "Other AI calls";
}

export function CostsPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [data, setData] = useState<AICostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setData(null);
    void apiFetch("/admin/ai-costs", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Cost report unavailable");
        const report = await response.json() as AICostReport;
        if (!report?.totals || !report.budget || !report.images || !report.coverage || !Array.isArray(report.groups)) throw new Error("Invalid cost report");
        if (!controller.signal.aborted) setData(report);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshToken, retry]);

  return (
    <div className={styles.costs}>
      <header>
        <h2>AI costs this month</h2>
        <p>Month to date in UTC. Recorded estimates cover this app’s AI calls; they are not the total running cost of Chef World.</p>
      </header>
      {loading ? <p role="status">Loading the cost report…</p> : null}
      {error ? <div className={styles.error} role="alert">
        <p>We could not load the cost report. Estimates are unavailable right now.</p>
        <button type="button" onClick={() => setRetry(value => value + 1)}>Retry cost report</button>
      </div> : null}
      {data ? <>
        <p className={styles.period}>{date(data.period_start)} – {date(data.period_end)} · USD · Updated {new Date(data.generated_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p>
        <dl className={styles.metrics}>
          <div aria-label="Recorded AI estimate"><dt>Recorded AI estimate</dt><dd>{money(data.totals.estimated_usd)}</dd><small>Priced usage from recorded calls</small></div>
          <div aria-label="Reserved budget"><dt>Reserved budget</dt><dd>{money(data.totals.reserved_usd)}</dd><small>Pending or unresolved calls; not settled spend</small></div>
          <div aria-label="Uncertain reservations"><dt>Uncertain reservations</dt><dd>{money(data.totals.unknown_reserved_usd)}</dd><small>Included in reserved budget above</small></div>
          <div aria-label="AI budget remaining"><dt>AI budget remaining</dt><dd>{money(data.budget.remaining_usd)}</dd><small>Shared monthly cap: {money(data.budget.monthly_cap_usd)}</small></div>
        </dl>
        <div className={styles.coverage}>
          <p><strong>Partial history.</strong> {data.coverage.first_recorded_at ? `First ledger record: ${date(data.coverage.first_recorded_at)}.` : "No ledger records yet."} Earlier usage, other API keys and provider invoices are not reconstructed.</p>
          {data.totals.unpriced_calls > 0 ? <p>{data.totals.unpriced_calls.toLocaleString()} calls have no priced result. The recorded estimate does not include their final charges.</p> : null}
          <p>{data.scope}</p>
        </div>
        <section aria-labelledby="ai-provider-breakdown">
          <h3 id="ai-provider-breakdown">Provider breakdown</h3>
          <p>{data.totals.calls.toLocaleString()} provider call reservations · {data.totals.input_tokens.toLocaleString()} input tokens · {data.totals.output_tokens.toLocaleString()} output tokens</p>
          {data.groups.length ? <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="AI provider cost breakdown">
              <thead><tr><th scope="col">Service / model</th><th scope="col">Calls</th><th scope="col">Tokens in / out</th><th scope="col">Estimated spend</th><th scope="col">Reserved</th><th scope="col">Uncertain</th></tr></thead>
              <tbody>{data.groups.map(group => <tr key={`${group.provider}:${group.kind}:${group.model}:${group.operation}`}>
                <th scope="row"><strong>{groupLabel(group)}</strong><span>{group.model}</span><small>{group.operation.replaceAll("_", " ")}</small></th>
                <td>{group.calls.toLocaleString()}<small>{group.completed} priced · {group.failed} denied<br />{group.pending} pending · {group.unknown} uncertain</small></td>
                <td>{group.input_tokens.toLocaleString()} / {group.output_tokens.toLocaleString()}</td>
                <td>{money(group.estimated_usd)}{group.unpriced_calls ? <small>{group.unpriced_calls} unpriced</small> : null}</td>
                <td>{money(group.reserved_usd)}</td><td>{money(group.unknown_reserved_usd)}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className={styles.empty}>No AI calls recorded this month.</p>}
        </section>
        <section className={styles.images} aria-labelledby="image-outcomes">
          <div><h3 id="image-outcomes">Recipe image generation</h3>
            <p>{data.images.admin_daily_limit}/day for admins · {data.images.regular_daily_limit}/day for other accounts</p>
          </div>
          <dl><div><dt>Requests</dt><dd>{data.images.requests.toLocaleString()}</dd></div><div><dt>Completed</dt><dd>{data.images.completed.toLocaleString()}</dd></div><div><dt>Failed</dt><dd>{data.images.failed.toLocaleString()}</dd></div><div><dt>Pending</dt><dd>{data.images.pending.toLocaleString()}</dd></div></dl>
          <p>Image outcomes are separate from provider accounting: a failed image can still incur a provider charge. {data.coverage.image_first_recorded_at ? `First image ledger record: ${date(data.coverage.image_first_recorded_at)}.` : "No image ledger records yet."}</p>
          <p>Admin image account budget: {money(data.budget.admin_image_account_cap_usd)}/month. Standard account budget: {money(data.budget.account_monthly_cap_usd)}/month. Monthly and short-term limits still apply.</p>
        </section>
      </> : null}
      <section className={styles.billing} aria-labelledby="provider-billing">
        <h3 id="provider-billing">Provider usage &amp; billing</h3>
        <p>OpenAI API usage is billed to the project behind the app’s server API key, separately from a ChatGPT subscription. Video analysis through Gemini is billed by Google.</p>
        <p>Provider invoices may differ because of cached-token discounts, delayed usage, credits and taxes. AWS and Vercel hosting are not included in these AI estimates.</p>
        <nav aria-label="Provider billing dashboards">
          <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer">OpenAI usage</a>
          <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer">OpenAI billing</a>
          <a href="https://aistudio.google.com/usage" target="_blank" rel="noopener noreferrer">Gemini usage &amp; billing</a>
          <a href="https://console.aws.amazon.com/billing/home" target="_blank" rel="noopener noreferrer">AWS billing</a>
          <a href="https://vercel.com/dashboard/usage" target="_blank" rel="noopener noreferrer">Vercel usage &amp; billing</a>
        </nav>
      </section>
    </div>
  );
}
