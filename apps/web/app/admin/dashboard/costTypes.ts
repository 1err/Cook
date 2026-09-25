export type CostTotals = {
  calls: number;
  completed: number;
  failed: number;
  pending: number;
  unknown: number;
  input_tokens: number;
  output_tokens: number;
  estimated_usd: string;
  reserved_usd: string;
  unknown_reserved_usd: string;
  unpriced_calls: number;
};

export type AICostReport = {
  month_utc: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  scope: string;
  coverage: { first_recorded_at: string | null; image_first_recorded_at: string | null; complete_history: boolean };
  budget: { monthly_cap_usd: string; spent_usd: string; reserved_usd: string; remaining_usd: string; account_monthly_cap_usd: string; admin_image_account_cap_usd: string };
  totals: CostTotals;
  groups: (CostTotals & { provider: "openai" | "google" | "unknown"; kind: "image" | "text" | "video" | "other"; model: string; operation: string })[];
  images: { requests: number; completed: number; failed: number; pending: number; admin_daily_limit: number; regular_daily_limit: number };
};
