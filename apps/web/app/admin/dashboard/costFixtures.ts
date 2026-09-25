import type { AICostReport, CostTotals } from "./costTypes";

// Synthetic unit/E2E fixtures only; the application never imports this module.

export const emptyCostTotals: CostTotals = { calls: 0, completed: 0, failed: 0, pending: 0, unknown: 0, input_tokens: 0, output_tokens: 0, estimated_usd: "0", reserved_usd: "0", unknown_reserved_usd: "0", unpriced_calls: 0 };
export const emptyCostReport: AICostReport = {
  month_utc: "2026-09-01", generated_at: "2026-09-25T18:00:00Z", period_start: "2026-09-01T00:00:00Z", period_end: "2026-09-25T18:00:00Z",
  scope: "App-managed AI calls recorded this UTC month. Excludes other-key usage, taxes and hosting.",
  coverage: { first_recorded_at: null, image_first_recorded_at: null, complete_history: false },
  budget: { monthly_cap_usd: "30", spent_usd: "0", reserved_usd: "0", remaining_usd: "30", account_monthly_cap_usd: "2", admin_image_account_cap_usd: "30" },
  totals: { ...emptyCostTotals }, groups: [],
  images: { requests: 0, completed: 0, failed: 0, pending: 0, admin_daily_limit: 100, regular_daily_limit: 3 },
};

export const exampleCostReport: AICostReport = {
  ...emptyCostReport,
  coverage: { first_recorded_at: "2026-09-24T12:00:00Z", image_first_recorded_at: "2026-09-25T12:00:00Z", complete_history: false },
  budget: { ...emptyCostReport.budget, spent_usd: "1.252", reserved_usd: "2.40", remaining_usd: "26.348" },
  totals: { calls: 7, completed: 3, failed: 1, pending: 1, unknown: 2, input_tokens: 12500, output_tokens: 7000, estimated_usd: "1.252", reserved_usd: "2.40", unknown_reserved_usd: "1.20", unpriced_calls: 2 },
  groups: [
    { ...emptyCostTotals, provider: "openai", kind: "image", model: "gpt-image-1.5", operation: "recipe_image", calls: 4, completed: 1, failed: 1, pending: 1, unknown: 1, input_tokens: 2500, output_tokens: 6000, estimated_usd: "1.20", reserved_usd: "2", unknown_reserved_usd: "1", unpriced_calls: 1 },
    { ...emptyCostTotals, provider: "openai", kind: "text", model: "gpt-4o-mini", operation: "recipe_parse", calls: 1, completed: 1, input_tokens: 2000, output_tokens: 1000, estimated_usd: "0.002" },
    { ...emptyCostTotals, provider: "google", kind: "video", model: "gemini-3.5-flash-lite", operation: "video_import", calls: 2, completed: 1, unknown: 1, input_tokens: 8000, output_tokens: 0, estimated_usd: "0.05", reserved_usd: "0.40", unknown_reserved_usd: "0.20", unpriced_calls: 1 },
  ],
  images: { requests: 4, completed: 1, failed: 2, pending: 1, admin_daily_limit: 100, regular_daily_limit: 3 },
};
