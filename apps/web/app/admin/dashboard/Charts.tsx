import type { Overview, Day, Breakdown } from "./types";
import styles from "./Dashboard.module.css";

export function AudienceChart({ days }: { days: Day[] }) {
  const hasData = days.some((d) => (d.visitors || 0) > 0 || d.signups > 0);
  const max = Math.max(4, ...days.flatMap((d) => [d.visitors || 0, d.signups]));
  const x = (i: number) => 38 + (i * 642) / Math.max(1, days.length - 1);
  const y = (n: number) => 180 - (n / max) * 150;
  function path(key: "visitors" | "signups") {
    let previous = false;
    return days
      .map((d, i) => {
        const v = d[key];
        if (v === null) {
          previous = false;
          return "";
        }
        const point = `${previous ? "L" : "M"}${x(i)},${y(v)}`;
        previous = true;
        return point;
      })
      .join(" ");
  }
  return (
    <div className={styles.chartWrap}>
      <svg
        viewBox="0 0 710 220"
        role="img"
        aria-label={
          hasData
            ? "Website visitors and new users by day"
            : "No audience activity recorded yet"
        }
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="38"
              x2="685"
              y1={y((i * max) / 4)}
              y2={y((i * max) / 4)}
              stroke="var(--cw-color-divider)"
              strokeDasharray="3 5"
            />
            <text x="20" y={y((i * max) / 4) + 4} textAnchor="end">
              {Math.round((i * max) / 4)}
            </text>
          </g>
        ))}
        {hasData && (
          <>
            <path
              d={path("visitors")}
              fill="none"
              stroke="var(--cw-color-sage)"
              strokeWidth="2.5"
            />
            <path
              d={path("signups")}
              fill="none"
              stroke="var(--cw-color-action)"
              strokeWidth="2.5"
            />
            {days.map((d, i) => (
              <g key={d.day}>
                {d.visitors !== null && (
                  <circle
                    cx={x(i)}
                    cy={y(d.visitors)}
                    r="3"
                    fill="var(--cw-color-sage)"
                  >
                    <title>
                      {d.day}: {d.visitors} visitors
                    </title>
                  </circle>
                )}
                <circle
                  cx={x(i)}
                  cy={y(d.signups)}
                  r="3"
                  fill="var(--cw-color-action)"
                >
                  <title>
                    {d.day}: {d.signups} new users
                  </title>
                </circle>
              </g>
            ))}
          </>
        )}
        {days
          .filter(
            (_, i) =>
              i === 0 ||
              i === days.length - 1 ||
              i === Math.floor(days.length / 3) ||
              i === Math.floor((days.length * 2) / 3),
          )
          .map((d) => (
            <text
              key={d.day}
              x={x(days.indexOf(d))}
              y="210"
              textAnchor="middle"
            >
              {new Date(d.day + "T12:00:00Z").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </text>
          ))}
      </svg>
      {!hasData && (
        <div className={styles.chartEmpty}>
          <strong>Your audience starts here</strong>
          <span>
            Visits and signups will appear as people discover Chef World.
          </span>
        </div>
      )}
    </div>
  );
}

export function Funnel({ data }: { data: Overview["engagement"]["funnel"] }) {
  const stages = [
    ["signed_up", "Signed up"],
    ["saved_recipe", "Saved a recipe"],
    ["planned_meal", "Planned a meal"],
    ["started_cooking", "Started cooking"],
    ["completed_cooking", "Completed cooking"],
  ];
  return (
    <div className={styles.funnel}>
      {stages.map(([key, label]) => {
        const value = data[key] || 0;
        const percentage = data.signed_up ? (100 * value) / data.signed_up : 0;
        return (
          <div key={key}>
            <div className={styles.barLabel}>
              <span>{label}</span>
              <span>
                {value.toLocaleString()}{" "}
                <small>· {Math.round(percentage)}%</small>
              </span>
            </div>
            <div className={styles.barTrack}>
              <div style={{ width: `${Math.min(100, percentage)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BreakdownTable({
  title,
  items,
  measure = "visitors",
}: {
  title: string;
  items: Breakdown[];
  measure?: "visitors" | "views";
}) {
  const max = Math.max(1, ...items.map((i) => i[measure]));
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {items.length ? (
        <div className={styles.breakdown}>
          {items.map((i) => (
            <div key={i.label}>
              <div className={styles.barLabel}>
                <span>{i.label}</span>
                <strong>{i[measure].toLocaleString()}</strong>
              </div>
              <div className={styles.barTrack}>
                <div style={{ width: `${(i[measure] / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>
          No {title.toLowerCase()} recorded in this period.
        </p>
      )}
    </section>
  );
}
