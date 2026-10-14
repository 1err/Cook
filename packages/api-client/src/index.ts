export { RecipePager } from "./recipePager";
export { runRecipeImport } from "./recipeImport";
import { runRecipeImport } from "./recipeImport";
export { loadStoreProductBatches } from "./storeProductBatches";
import type {
  IngredientOption,
  LibrarySearchPage,
  CookingActionPayload,
  CookingSession,
  InstacartItem,
  MealPlanDay,
  Recipe,
  RecipeImageInput,
  RecipePage,
  RecipeStep,
  RecipeTagSlug,
  RecipeImportJob,
  RecipeImportCapabilities,
  ShoppingListItem,
  User,
} from "@cooking/shared";
import { normalizeStoreProductResponse } from "./storeProductExpiry";
export { normalizeStoreProductResponse } from "./storeProductExpiry";

export type RecipePageOptions = { expectedAccountId?: string; limit?: number; cursor?: string | null; q?: string; tags?: RecipeTagSlug[] };
export type LibrarySearchOptions = RecipePageOptions & { scope?: "all" | "mine" | "catalog"; ingredients?: string[]; match?: "all" | "any"; includeIngredients?: boolean };
export function librarySearchQuery(options: LibrarySearchOptions = {}): string {
  const params = new URLSearchParams(recipePageQuery(options));
  params.set("scope", options.scope ?? "all");
  params.set("match", options.match ?? "all");
  if (options.includeIngredients) params.set("include_ingredients", "true");
  for (const name of options.ingredients ?? []) params.append("ingredients", name);
  return params.toString();
}
export function recipePageQuery(options: RecipePageOptions = {}): string {
  const params = new URLSearchParams({ limit: String(options.limit ?? 40) });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.q?.trim()) params.set("q", options.q.trim());
  for (const tag of options.tags ?? []) params.append("tags", tag);
  return params.toString();
}

/** Resolve only selected recipes; at most four detail requests run at a time. */
export async function resolveRecipeDetails(get: (id: string) => Promise<Recipe>, ids: string[]): Promise<Recipe[]> {
  const pending = [...new Set(ids)];
  const found: Recipe[] = [];
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const id = pending.shift()!;
      try { found.push(await get(id)); }
      catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    }
  }));
  return found;
}

export * from "./menuArtwork";
export * from "./menuDesign";

export type MenuCreationAccess = {
  allowed: boolean;
  is_admin: boolean;
  daily_limit: number | null;
  remaining: number | null;
  resets_at: string;
};
export type MenuCreationResult = { request_id: string; created_at: string };

export type AuthStrategy =
  | { kind: "cookie" }
  | { kind: "bearer"; getToken: () => string | null | undefined };

export type ApiClientOptions = {
  baseUrl: string;
  auth: AuthStrategy;
  defaultHeaders?: HeadersInit;
  getRequestHeaders?: () => HeadersInit;
  onUnauthorized?: () => void;
  getAuthGeneration?: () => number;
};

export type RefineItemInput = { name: string; quantity: string };
export type RefineResult = {
  refinement_status?: "refined" | "partial" | "fallback";
  remove: string[];
  likely_pantry: { name: string; reason: string }[];
  purchase_items: { name: string; suggested_purchase: string; category?: string }[];
};

export type StoreProduct = { name: string; price: string; image: string; url: string };
export type StoreProductsResponse = {
  products: StoreProduct[];
  expires_at: string | null;
  server_time?: string;
};
export type StoreProductsBatchEntry = {
  query: string;
  status: "fresh" | "missing";
  products: StoreProduct[];
  expires_at: string | null;
};
export type StoreProductsBatchResponse = {
  entries: StoreProductsBatchEntry[];
  server_time?: string;
};

export type ParseLinkPayload = {
  url: string;
  notes?: string;
  title?: string;
  library_tags?: RecipeTagSlug[];
};

export type ParseTranscriptPayload = {
  transcript: string;
  source_url?: string;
  notes?: string;
  title?: string;
  library_tags?: RecipeTagSlug[];
};

export type RecipeImportPayload = {
  mode: "link" | "text" | "video";
  url?: string;
  transcript?: string;
  notes?: string;
  title?: string;
  library_tags?: RecipeTagSlug[];
};

export type UploadImageResult = { upload_url: string; file_url: string };

export type RecipeImageAccess = {
  enabled: boolean;
  allowed: boolean;
  reason: "disabled" | "membership_required" | "daily_limit" | "unavailable" | "global_limit" | null;
  daily_limit: number;
  remaining: number;
  resets_at: string;
};

export type GenerateRecipeImagePayload = RecipeImageInput & { request_id: string };

export type RecipeImageGeneration = {
  request_id: string;
  status: "completed" | "pending" | "failed";
  file_url: string | null;
  error_code?: string | null;
};

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
      if (Array.isArray(detail)) {
        // FastAPI validation rows may contain the submitted password or recipe
        // text in `input`/`ctx`. Only their human-readable messages belong in UI.
        const messages = detail.flatMap((row) =>
          row && typeof row === "object" && typeof row.msg === "string" ? [row.msg] : [],
        );
        return { code: null, message: messages.join(" ") || "The request could not be validated." };
      }
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

function actorHeaders(expectedAccountId?: string): HeadersInit | undefined {
  return expectedAccountId ? { "X-Chef-World-Account-ID": expectedAccountId } : undefined;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  async function request(path: string, requestOptions: RequestOptions = {}): Promise<Response> {
    const authGeneration = options.getAuthGeneration?.();
    const { headers, body, skipJsonContentType = false, ...rest } = requestOptions;
    const isFormData = body instanceof FormData;
    const nextHeaders = new Headers(options.defaultHeaders || {});
    if (options.getRequestHeaders) {
      new Headers(options.getRequestHeaders()).forEach((value, key) => nextHeaders.set(key, value));
    }
    if (!skipJsonContentType && !isFormData && body != null && !nextHeaders.has("Content-Type")) {
      nextHeaders.set("Content-Type", "application/json");
    }
    if (headers) {
      const custom = new Headers(headers);
      custom.forEach((value: string, key: string) => nextHeaders.set(key, value));
    }
    if (isFormData) nextHeaders.delete("Content-Type");
    const init: RequestInit = {
      body,
      ...rest,
      headers: nextHeaders,
    };
    if (options.auth.kind === "cookie") {
      init.credentials = "include";
    } else {
      // Native fetch can otherwise reuse the OS cookie jar, even before login.
      init.credentials = "omit";
      const token = options.auth.getToken();
      if (token) nextHeaders.set("Authorization", `Bearer ${token}`);
    }
    const response = await fetch(`${baseUrl}${path}`, init);
    if (response.status === 401 && options.getAuthGeneration?.() === authGeneration) {
      options.onUnauthorized?.();
    }
    return response;
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
      capabilities: () => json<{ password_recovery: boolean; email_verification: boolean }>("/auth/capabilities"),
      requestPasswordReset: (email: string) => json<{ ok: boolean }>("/auth/password-reset/request", {
        method: "POST", body: JSON.stringify({ email }),
      }),
      confirmPasswordReset: (token: string, password: string) => json<{ ok: boolean }>("/auth/password-reset/confirm", {
        method: "POST", body: JSON.stringify({ token, password }),
      }),
      requestEmailVerification: (expectedAccountId?: string) => json<{ ok: boolean }>("/auth/email-verification/request", { method: "POST", headers: actorHeaders(expectedAccountId) }),
      confirmEmailVerification: (token: string) => json<{ ok: boolean }>("/auth/email-verification/confirm", {
        method: "POST", body: JSON.stringify({ token }),
      }),
      logoutAll: () => json<{ ok: boolean }>("/auth/logout-all", { method: "POST" }),
      deleteAccount: (password: string, expectedAccountId?: string) => json<{ ok: boolean }>("/auth/account", {
        method: "DELETE", headers: actorHeaders(expectedAccountId), body: JSON.stringify({ password }),
      }),
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
      importCapabilities: () => json<RecipeImportCapabilities>("/recipes/import-capabilities"),
      createImportJob: (payload: RecipeImportPayload) => json<RecipeImportJob>("/recipes/import-jobs", { method: "POST", body: JSON.stringify(payload) }),
      createMediaImportJob: (form: FormData) => json<RecipeImportJob>("/recipes/import-jobs/media", { method: "POST", body: form }),
      /** Native compatibility: the production media endpoint creates an asynchronous job. */
      parseVideo: (form: FormData, options: { signal?: AbortSignal } = {}) => runRecipeImport(
        () => json<RecipeImportJob>("/recipes/import-jobs/media", { method: "POST", body: form }),
        {
          getImportJob: (id, signal) => json<RecipeImportJob>(`/recipes/import-jobs/${encodeURIComponent(id)}`, { signal }),
          cancelImportJob: (id) => json<RecipeImportJob>(`/recipes/import-jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
        },
        options.signal ?? new AbortController().signal,
      ),
      getImportJob: (id: string, signal?: AbortSignal) => json<RecipeImportJob>(`/recipes/import-jobs/${encodeURIComponent(id)}`, { signal }),
      cancelImportJob: (id: string) => json<RecipeImportJob>(`/recipes/import-jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
      /** @deprecated Compatibility for older releases; use page for lists. */
      list: () => json<Recipe[]>("/recipes"),
      ingredientOptions: () => json<IngredientOption[]>("/recipes/ingredient-options"),
      searchPage: (options: LibrarySearchOptions = {}) => json<LibrarySearchPage>(`/recipes/search/page?${librarySearchQuery(options)}`, { headers: actorHeaders(options.expectedAccountId) }),
      page: (options: RecipePageOptions = {}) => json<RecipePage>(`/recipes/page?${recipePageQuery(options)}`, { headers: actorHeaders(options.expectedAccountId) }),
      catalogPage: (options: RecipePageOptions = {}) => json<RecipePage>(`/recipes/catalog/page?${recipePageQuery(options)}`, { headers: actorHeaders(options.expectedAccountId) }),
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
      /** @deprecated Use catalogPage for bounded summary browsing. */
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
      imageGenerationAccess: (options?: { signal?: AbortSignal }) =>
        json<RecipeImageAccess>("/recipes/image-generation/access", { signal: options?.signal }),
      generateImage: (payload: GenerateRecipeImagePayload, options?: { signal?: AbortSignal }) =>
        json<RecipeImageGeneration>("/recipes/generate-image", {
          method: "POST", body: JSON.stringify(payload), signal: options?.signal,
        }),
      imageGenerationStatus: (requestId: string, options?: { signal?: AbortSignal }) =>
        json<RecipeImageGeneration>(`/recipes/image-generation/${encodeURIComponent(requestId)}`, {
          signal: options?.signal,
        }),
    },
    menus: {
      generateDesign: (payload: import("./menuDesign").GenerateMenuDesignPayload, options?: { signal?: AbortSignal }) =>
        json<import("@cooking/shared").MenuDesign>("/menus/designs", {
          method: "POST", body: JSON.stringify(payload), signal: options?.signal,
        }),
      recipeImage: (recipeId: string, options?: { signal?: AbortSignal }) =>
        request(`/menus/recipe-images/${encodeURIComponent(recipeId)}`, { signal: options?.signal }),
      access: (options?: { signal?: AbortSignal }) =>
        json<MenuCreationAccess>("/menus/access", { signal: options?.signal }),
      create: (payload: { request_id: string }, options?: { signal?: AbortSignal }) =>
        json<MenuCreationResult>("/menus/creations", {
          method: "POST", body: JSON.stringify(payload), signal: options?.signal,
        }),
      artworkAccess: (options?: { signal?: AbortSignal }) =>
        json<RecipeImageAccess>("/menus/artwork/access", { signal: options?.signal }),
      generateArtwork: (payload: import("./menuArtwork").MenuArtworkRequestPayload, options?: { signal?: AbortSignal }) =>
        json<import("./menuArtwork").MenuArtworkResult>("/menus/artwork", {
          method: "POST", body: JSON.stringify(payload), signal: options?.signal,
        }),
      artworkStatus: (requestId: string, options?: { signal?: AbortSignal }) =>
        json<import("./menuArtwork").MenuArtworkResult>(`/menus/artwork/${encodeURIComponent(requestId)}`, {
          signal: options?.signal,
        }),
      artworkFile: (requestId: string, options?: { signal?: AbortSignal }) =>
        request(`/menus/artwork/${encodeURIComponent(requestId)}/file`, {
          signal: options?.signal,
        }),
    },
    users: {
      searchByEmail: (email: string) =>
        json<User>(`/users/search?email=${encodeURIComponent(email)}`),
      libraryPage: (userId: string, options: RecipePageOptions = {}) =>
        json<RecipePage>(`/users/${encodeURIComponent(userId)}/recipes/page?${recipePageQuery(options)}`, { headers: actorHeaders(options.expectedAccountId) }),
      libraryRecipe: (userId: string, recipeId: string) =>
        json<Recipe & { already_saved: boolean }>(`/users/${encodeURIComponent(userId)}/recipes/${encodeURIComponent(recipeId)}`),
      /** @deprecated Use libraryPage or libraryRecipe. */
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
      updateDay: (date: string, payload: { breakfast: string[]; lunch: string[]; dinner: string[] }, expectedRevision?: number) =>
        json<MealPlanDay>(`/meal-plan/${encodeURIComponent(date)}`, {
          method: "PUT",
          body: JSON.stringify({ ...payload, ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }) }),
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
      createInstacartLink: (
        payload: { title: string; items: InstacartItem[] },
        options: { signal?: AbortSignal } = {},
      ) => json<{ url: string }>("/shopping-list/instacart", {
        method: "POST",
        body: JSON.stringify(payload),
        signal: options.signal,
      }),
      list: (start: string, end: string) =>
        json<ShoppingListItem[]>(`/shopping-list?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
      refine: (items: RefineItemInput[]) =>
        json<RefineResult>("/shopping-list/refine", {
          method: "POST",
          body: JSON.stringify({ items }),
        }),
      storeProducts: async (query: string) => {
        const startedAt = Date.now();
        const response = await json<StoreProductsResponse>(`/store-products?query=${encodeURIComponent(query)}`);
        return normalizeStoreProductResponse(response, startedAt);
      },
      storeProductsBatch: async (queries: string[]) => {
        const startedAt = Date.now();
        const response = await json<StoreProductsBatchResponse>("/store-products/batch", {
          method: "POST",
          body: JSON.stringify({ queries }),
        });
        return normalizeStoreProductResponse(response, startedAt);
      },
    },
    admin: {
      cachePreview: (params: URLSearchParams) => json(`/admin/cache-preview?${params.toString()}`),
      refreshCache: (forceRefresh: boolean) =>
        json("/admin/cache-refresh", { method: "POST", body: JSON.stringify({ force_refresh: forceRefresh }) }),
      cacheRefreshStatus: () => json("/admin/cache-refresh-status"),
    },
  };
}
