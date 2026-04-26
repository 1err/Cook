import type { MealPlanDay, Recipe, ShoppingListItem } from "@cooking/shared";

export type AuthStrategy =
  | { kind: "cookie" }
  | { kind: "bearer"; getToken: () => string | null | undefined };

export type ApiClientOptions = {
  baseUrl: string;
  auth: AuthStrategy;
  defaultHeaders?: HeadersInit;
};

export type RefineItemInput = { name: string; quantity: string };
export type RefineResult = {
  remove: string[];
  likely_pantry: { name: string; reason: string }[];
  purchase_items: { name: string; suggested_purchase: string; category?: string }[];
};

export type StoreProduct = { name: string; price: string; image: string; url: string };

type RequestOptions = RequestInit & { skipJsonContentType?: boolean };

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  async function request(path: string, requestOptions: RequestOptions = {}): Promise<Response> {
    const { headers, body, skipJsonContentType = false, ...rest } = requestOptions;
    const isFormData = body instanceof FormData;
    const nextHeaders = new Headers(options.defaultHeaders || {});
    if (!skipJsonContentType && !isFormData && body != null && !nextHeaders.has("Content-Type")) {
      nextHeaders.set("Content-Type", "application/json");
    }
    if (headers) {
      const custom = new Headers(headers);
      custom.forEach((value, key) => nextHeaders.set(key, value));
    }
    const init: RequestInit = {
      body,
      ...rest,
      headers: nextHeaders,
    };
    if (options.auth.kind === "cookie") {
      init.credentials = "include";
    } else {
      const token = options.auth.getToken();
      if (token) nextHeaders.set("Authorization", `Bearer ${token}`);
    }
    return fetch(`${baseUrl}${path}`, init);
  }

  async function json<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const res = await request(path, requestOptions);
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  return {
    request,
    auth: {
      login: (email: string, password: string) =>
        json<{ id: string; email: string; access_token?: string }>(`/auth/login`, {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      register: (email: string, password: string) =>
        json<{ id: string; email: string; access_token?: string }>(`/auth/register`, {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      me: () => json<{ id: string; email: string }>("/auth/me"),
      logout: () => json<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    },
    recipes: {
      list: () => json<Recipe[]>("/recipes"),
      get: (id: string) => json<Recipe>(`/recipes/${encodeURIComponent(id)}`),
      create: (payload: Partial<Recipe>) =>
        json<Recipe>("/recipes", { method: "POST", body: JSON.stringify(payload) }),
      update: (id: string, payload: Partial<Recipe>) =>
        json<Recipe>(`/recipes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
      remove: (id: string) => request(`/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }),
      catalog: () => json<Recipe[]>("/recipes/catalog"),
      copyCatalog: (id: string) => json<Recipe>(`/recipes/catalog/${encodeURIComponent(id)}/copy`, { method: "POST" }),
    },
    mealPlan: {
      list: (start: string, end: string) =>
        json<MealPlanDay[]>(`/meal-plan?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
      updateDay: (date: string, payload: { breakfast: string[]; lunch: string[]; dinner: string[] }) =>
        json<MealPlanDay>(`/meal-plan/${encodeURIComponent(date)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        }),
    },
    shopping: {
      list: (start: string, end: string) =>
        json<ShoppingListItem[]>(`/shopping-list?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
      refine: (items: RefineItemInput[]) =>
        json<RefineResult>("/shopping-list/refine", {
          method: "POST",
          body: JSON.stringify({ items }),
        }),
      storeProducts: (query: string, store: "weee" | "amazon") =>
        json<StoreProduct[]>(
          `/store-products?query=${encodeURIComponent(query)}&store=${encodeURIComponent(store)}`
        ),
    },
    admin: {
      cachePreview: (params: URLSearchParams) => json(`/admin/cache-preview?${params.toString()}`),
      refreshCache: (forceRefresh: boolean) =>
        json("/admin/cache-refresh", { method: "POST", body: JSON.stringify({ force_refresh: forceRefresh }) }),
      cacheRefreshStatus: () => json("/admin/cache-refresh-status"),
    },
  };
}
