/** Browser-only GIS handoff. Authentication remains entirely in the API verifier. */
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeAuthRedirect } from "@cooking/shared";

const CONTEXT_COOKIE = "cw_google_redirect_context";
const CREDENTIAL_COOKIE = "cw_google_redirect_credential";
const COOKIE_PATH = "/api/auth/google";
const TTL_SECONDS = 600;
const COOKIE_VALUE_LIMIT = 3500;
const RETURN_PATHS = new Set(["/login", "/register", "/settings"]);
const PUBLIC_ORIGINS = new Set(["https://chef-world.com", "https://www.chef-world.com"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type RedirectContext = { return_path: string; redirect: string; expires_at: number; expected_account_id?: string };
type PendingCredential = { credential: string; expires_at: number; expected_account_id?: string };

function privateResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function siteOrigin(request: NextRequest): string | null {
  const url = new URL(request.url);
  if (PUBLIC_ORIGINS.has(url.origin)) return url.origin;
  if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && ["http:", "https:"].includes(url.protocol)) return url.origin;
  return null;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = siteOrigin(request);
  return origin !== null && request.headers.get("Origin") === origin;
}

function forbidden(): NextResponse {
  return privateResponse(NextResponse.json({ error: "Invalid request origin." }, { status: 403 }));
}

function secureCookies(request: NextRequest): boolean {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}

function removeBridgeCookies(response: NextResponse, request: NextRequest): void {
  for (const name of [CONTEXT_COOKIE, CREDENTIAL_COOKIE]) {
    response.cookies.set(name, "", { path: COOKIE_PATH, httpOnly: true, secure: secureCookies(request), sameSite: "strict", maxAge: 0 });
  }
}

function singleCookie(request: NextRequest, name: string): string | null {
  const matches = (request.headers.get("Cookie") || "").split(";").filter(part => part.trim().split("=", 1)[0] === name);
  if (matches.length !== 1) return null;
  return request.cookies.get(name)?.value ?? null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fresh(expires: unknown): expires is number {
  return typeof expires === "number" && Number.isSafeInteger(expires)
    && expires > Date.now() && expires <= Date.now() + TTL_SECONDS * 1000;
}

function safeDestination(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/library";
  try {
    let decoded = value;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (safeAuthRedirect(decoded) !== decoded) return "/library";
      decoded = decodeURIComponent(decoded);
    }
    if (safeAuthRedirect(decoded) !== decoded) return "/library";
  } catch { return "/library"; }
  return safeAuthRedirect(value);
}

function accountId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function parseContext(value: string | null): RedirectContext | null {
  try {
    if (!value || value.length > 2048) return null;
    const data: unknown = JSON.parse(value);
    if (!record(data) || typeof data.return_path !== "string" || !RETURN_PATHS.has(data.return_path) || !fresh(data.expires_at)) return null;
    const expected = accountId(data.expected_account_id);
    if (data.return_path === "/settings" && !expected) return null;
    return { return_path: data.return_path, redirect: safeDestination(data.redirect), expires_at: data.expires_at,
      ...(data.return_path === "/settings" ? { expected_account_id: expected! } : {}) };
  } catch { return null; }
}

function parsePending(value: string | null): PendingCredential | null {
  try {
    if (!value || encodeURIComponent(value).length > COOKIE_VALUE_LIMIT) return null;
    const data: unknown = JSON.parse(value);
    if (!record(data) || !fresh(data.expires_at) || typeof data.credential !== "string" || !JWT_PATTERN.test(data.credential)) return null;
    const expected = accountId(data.expected_account_id);
    if (data.expected_account_id !== undefined && !expected) return null;
    // This cookie is a transport envelope, never evidence of authentication.
    // Only the existing API validates Google's signature, claims and nonce.
    return { credential: data.credential, expires_at: data.expires_at, ...(expected ? { expected_account_id: expected } : {}) };
  } catch { return null; }
}

async function boundedText(request: NextRequest, limit: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function failedCallback(request: NextRequest): NextResponse {
  const origin = siteOrigin(request);
  if (!origin) return forbidden();
  const destination = new URL("/login", origin);
  destination.searchParams.set("google_error", "1");
  const response = privateResponse(NextResponse.redirect(destination, 303));
  removeBridgeCookies(response, request);
  return response;
}

export async function prepareGoogleRedirect(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return forbidden();
  try {
    if (request.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json") throw new Error("Invalid body");
    const data: unknown = JSON.parse(await boundedText(request, 2048));
    if (!record(data) || Object.keys(data).some(key => !["return_path", "redirect", "expected_account_id"].includes(key))
        || typeof data.return_path !== "string" || !RETURN_PATHS.has(data.return_path)
        || (data.redirect !== undefined && typeof data.redirect !== "string")) throw new Error("Invalid context");
    const expected = accountId(data.expected_account_id);
    if ((data.return_path === "/settings" && !expected) || (data.return_path !== "/settings" && data.expected_account_id !== undefined)) throw new Error("Invalid account scope");
    const context: RedirectContext = { return_path: data.return_path, redirect: safeDestination(data.redirect), expires_at: Date.now() + TTL_SECONDS * 1000,
      ...(expected ? { expected_account_id: expected } : {}) };
    const response = privateResponse(NextResponse.json({ ok: true }));
    removeBridgeCookies(response, request);
    response.cookies.set(CONTEXT_COOKIE, JSON.stringify(context), { path: COOKIE_PATH, httpOnly: true, secure: secureCookies(request), sameSite: secureCookies(request) ? "none" : "lax", maxAge: TTL_SECONDS });
    return response;
  } catch {
    return privateResponse(NextResponse.json({ error: "Google sign-in could not start. Please try again." }, { status: 400 }));
  }
}

export async function receiveGoogleRedirect(request: NextRequest): Promise<NextResponse> {
  const origin = siteOrigin(request);
  if (!origin) return forbidden();
  try {
    const context = parseContext(singleCookie(request, CONTEXT_COOKIE));
    if (!context) throw new Error("Missing context");
    const contentType = request.headers.get("Content-Type") || "";
    if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)(;|$)/i.test(contentType)) throw new Error("Invalid form");
    const body = await boundedText(request, 8192);
    const form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
    const csrfValues = form.getAll("g_csrf_token");
    const credentials = form.getAll("credential");
    const cookieCsrf = singleCookie(request, "g_csrf_token");
    const bodyCsrf = csrfValues[0];
    const token = credentials[0];
    if (csrfValues.length !== 1 || credentials.length !== 1 || typeof bodyCsrf !== "string" || !bodyCsrf || bodyCsrf.length > 512
        || !cookieCsrf || typeof token !== "string" || !JWT_PATTERN.test(token)) throw new Error("Invalid Google response");
    const supplied = Buffer.from(bodyCsrf);
    const expected = Buffer.from(cookieCsrf);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Invalid CSRF proof");
    const pending: PendingCredential = { credential: token, expires_at: Date.now() + TTL_SECONDS * 1000,
      ...(context.expected_account_id ? { expected_account_id: context.expected_account_id } : {}) };
    const cookieValue = JSON.stringify(pending);
    if (encodeURIComponent(cookieValue).length > COOKIE_VALUE_LIMIT) throw new Error("Credential too large");
    const destination = new URL(context.return_path, origin);
    destination.searchParams.set("google_resume", "1");
    destination.searchParams.set("redirect", context.redirect);
    const response = privateResponse(NextResponse.redirect(destination, 303));
    removeBridgeCookies(response, request);
    response.cookies.set(CREDENTIAL_COOKIE, cookieValue, { path: COOKIE_PATH, httpOnly: true, secure: secureCookies(request), sameSite: "strict", maxAge: TTL_SECONDS });
    return response;
  } catch { return failedCallback(request); }
}

export async function resumeGoogleRedirect(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return forbidden();
  const pending = parsePending(singleCookie(request, CREDENTIAL_COOKIE));
  if (!pending) return privateResponse(NextResponse.json({ error: "Google sign-in expired. Please try again." }, { status: 401 }));
  return privateResponse(NextResponse.json({ credential: pending.credential,
    ...(pending.expected_account_id ? { expected_account_id: pending.expected_account_id } : {}) }));
}

export async function clearGoogleRedirect(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return forbidden();
  const response = privateResponse(NextResponse.json({ ok: true }));
  removeBridgeCookies(response, request);
  return response;
}
