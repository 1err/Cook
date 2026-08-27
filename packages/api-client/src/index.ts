import type {
  CookingActionPayload,
  CookingSession,
  MealPlanDay,
  Recipe,
  RecipeStep,
  RecipeTagSlug,
  ShoppingListItem,
  User,
} from "@cooking/shared";

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
export type StoreProductsResponse = {
  products: StoreProduct[];
  expires_at: string | null;
};
export type StoreProductsBatchEntry = {
  query: string;
  status: "fresh" | "missing";
  products: StoreProduct[];
  expires_at: string | null;
};
export type StoreProductsBatchResponse = {
  entries: StoreProductsBatchEntry[];
};

export type ParseLinkPayload = {
  url: string;
  notes?: string;
  title?: string;
  library_tags?: RecipeTagSlug[];
};

export type ParseTranscriptPayload = {
  transcript: string;
  notes?: string;
  title?: string;
  library_tags?: RecipeTagSlug[];
};

export type UploadImageResult = { upload_url: string; file_url: string };

type RequestOptions = RequestInit & { skipJsonContentType?: boolean };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function parseErrorPayload(text: string): { code: string | null; message: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      const detail = "detail" in parsed ? (parsed as { detail?: unknown }).detail : parsed;
      if (detail && typeof detail === "object") {
        const code = "code" in detail && typeof (detail as { code?: unknown }).code === "string"
          ? (detail as { code: string }).code
          : null;
        const message = "message" in detail && typeof (detail as { message?: unknown }).message === "string"
          ? (detail as { message: string }).message
          : text;
        return { code, message };
      }
      if (typeof detail === "string") return { code: null, message: detail };
    }
  } catch {
    // Plain-text failures remain valid API errors.
  }
  return { code: null, message: text };
}

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
      custom.forEach((value: string, key: string) => nextHeaders.set(key, value));
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
      const parsed = parseErrorPayload(message || `${res.status} ${res.statusText}`);
      throw new ApiError(parsed.message, res.status, parsed.code);
    }
    return (await res.json()) as T;
  }

  return {
    request,
    auth: {
      login: (email: string, password: string) =>
        json<User & { access_token?: string }>(`/auth/login`, {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      register: (email: string, password: string) =>
        json<User & { access_token?: string }>(`/auth/register`, {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      me: () => json<User>("/auth/me"),
      logout: () => json<{ ok: boolean }>("/auth/logout", { method: "POST" }),
      setLibraryVisibility: (isPublic: boolean) =>
        json<{ is_library_public: boolean }>("/auth/library-visibility", {
          method: "POST",
          body: JSON.stringify({ is_public: isPublic }),
        }),
    },
    recipes: {
      list: () => json<Recipe[]>("/recipes"),
      get: (id: string) => json<Recipe>(`/recipes/${encodeURIComponent(id)}`),
      create: (payload: Partial<Recipe>) =>
        json<Recipe>("/recipes", { method: "POST", body: JSON.stringify(payload) }),
      update: (id: string, payload: Partial<Recipe>) =>
        json<Recipe>(`/recipes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
      estimateTutorial: (id: string, steps: RecipeStep[]) =>
        json<{ steps: RecipeStep[] }>(
          `/recipes/${encodeURIComponent(id)}/tutorial/estimate`,
          { method: "POST", body: JSON.stringify({ steps }) },
        ),
      remove: (id: string) => request(`/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }),
      catalog: () => json<Recipe[]>("/recipes/catalog"),
      copyCatalog: (id: string) => json<Recipe>(`/recipes/catalog/${encodeURIComponent(id)}/copy`, { method: "POST" }),
      editorStatus: () => json<{ can_manage: boolean }>("/recipes/catalog/editor-status"),
      setCatalogVisibility: (id: string, isPublic: boolean) =>
        json<Recipe>(`/recipes/${encodeURIComponent(id)}/catalog`, {
          method: "POST",
          body: JSON.stringify({ is_public: isPublic }),
        }),
      parseLink: (payload: ParseLinkPayload) =>
        json<Recipe>("/recipes/parse/link", { method: "POST", body: JSON.stringify(payload) }),
      parseTranscript: (payload: ParseTranscriptPayload) =>
        json<Recipe>("/recipes/parse/transcript", { method: "POST", body: JSON.stringify(payload) }),
      uploadImage: (formData: FormData) =>
        json<UploadImageResult>("/recipes/upload-image", { method: "POST", body: formData }),
    },
    users: {
      searchByEmail: (email: string) =>
        json<User>(`/users/search?email=${encodeURIComponent(email)}`),
      libraryRecipes: (userId: string) =>
        json<Recipe[]>(`/users/${encodeURIComponent(userId)}/recipes`),
      copyFriendRecipe: (userId: string, recipeId: string) =>
        json<Recipe>(
          `/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipeId)}/copy`,
          { method: "POST" },
        ),
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
    cooking: {
      active: () => json<CookingSession | null>("/cooking-session/active"),
      create: (recipeIds: string[]) =>
        json<CookingSession>("/cooking-session", {
          method: "POST",
          body: JSON.stringify({ recipe_ids: recipeIds }),
        }),
      addDishes: (sessionId: string, recipeIds: string[]) =>
        json<CookingSession>(
          `/cooking-session/${encodeURIComponent(sessionId)}/dishes`,
          {
            method: "POST",
            body: JSON.stringify({ recipe_ids: recipeIds }),
          },
        ),
      removeDish: (sessionId: string, dishId: string) =>
        json<CookingSession | null>(
          `/cooking-session/${encodeURIComponent(sessionId)}/dishes/${encodeURIComponent(dishId)}`,
          { method: "DELETE" },
        ),
      action: (sessionId: string, stepId: string, payload: CookingActionPayload) =>
        json<CookingSession>(
          `/cooking-session/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(stepId)}/actions`,
          { method: "POST", body: JSON.stringify(payload) },
        ),
      finish: (sessionId: string) =>
        json<{ ok: boolean }>(
          `/cooking-session/${encodeURIComponent(sessionId)}/finish`,
          { method: "POST" },
        ),
      discard: (sessionId: string) =>
        json<{ ok: boolean }>(`/cooking-session/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
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
      storeProducts: (query: string) =>
        json<StoreProductsResponse>(`/store-products?query=${encodeURIComponent(query)}`),
      storeProductsBatch: (queries: string[]) =>
        json<StoreProductsBatchResponse>("/store-products/batch", {
          method: "POST",
          body: JSON.stringify({ queries }),
        }),
    },
    admin: {
      cachePreview: (params: URLSearchParams) => json(`/admin/cache-preview?${params.toString()}`),
      refreshCache: (forceRefresh: boolean) =>
        json("/admin/cache-refresh", { method: "POST", body: JSON.stringify({ force_refresh: forceRefresh }) }),
      cacheRefreshStatus: () => json("/admin/cache-refresh-status"),
    },
  };
}
