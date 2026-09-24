export type Account = {
  id: string;
  email: string;
  created_at: string;
  is_admin: boolean;
  is_test: boolean;
  last_login_at: string | null;
  last_seen_at: string | null;
  first_recipe_at: string | null;
  first_plan_at: string | null;
  first_cook_at: string | null;
  recipes: number;
  plan_rows: number;
  logins: number | null;
  login_coverage?: "complete" | "partial" | "unavailable";
};
export type UsersPage = {
  items: Account[];
  total: number;
  limit: number;
  offset: number;
};
export type Detail = {
  coverage?: { partial: boolean; unavailable: boolean };
  user: Account;
  events: {
    occurred_at: string;
    name: string;
    platform: string;
    path: string | null;
  }[];
};
export type Breakdown = {
  label: string;
  views: number;
  visitors: number;
  signups: number;
};
export type Day = {
  day: string;
  signups: number;
  active_users: number | null;
  visitors: number | null;
  page_views: number | null;
  partial: boolean;
};
export type Overview = {
  collection?: {
    failures_since_process_start: number;
    last_failure_at: string | null;
  };
  range: { start: string; end: string; include_internal: boolean };
  timezone: string;
  refreshed_at: string;
  tracking_started_at: string;
  coverage: {
    available_from: string;
    partial: boolean;
    unavailable?: boolean;
    previous_complete: boolean;
    last_event_at: string | null;
  };
  totals: Record<string, number>;
  previous: Record<string, number>;
  active: { daily: number; weekly: number; monthly: number };
  series: Day[];
  acquisition: {
    sources: Breakdown[];
    pages: Breakdown[];
    landing_pages?: Breakdown[];
    devices: Breakdown[];
    browsers: Breakdown[];
    campaigns: Breakdown[];
    converted_visitors: number;
    unattributed_signups: number;
    signup_conversion: number | null;
  };
  engagement: {
    events: { name: string; count: number; users: number }[];
    funnel: Record<string, number>;
    cohorts: { week: string; users: number; weeks: (number | null)[] }[];
  };
};
export const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Not tracked yet";
export const eventLabel = (value: string) =>
  ({
    registered: "Signed up",
    login: "Logged in",
    page_view: "Viewed a page",
    recipe_saved: "Saved a recipe",
    meal_planned: "Planned a meal",
    cooking_started: "Started cooking",
    cooking_completed: "Completed cooking",
    retailer_handoff: "Opened a retailer",
    retailer_link_created: "Created a shopping link",
  })[value] || value;
