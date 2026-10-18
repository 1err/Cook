import { afterEach, beforeEach, expect, test, vi } from "vitest";

const googleWindow = window as typeof window & { google?: unknown };
let loadGoogleIdentity: typeof import("./googleIdentitySdk").loadGoogleIdentity;
const identity = { initialize: () => {}, renderButton: () => {} };
function scripts() { return [...document.querySelectorAll<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')]; }
function startLoad() { const pending = loadGoogleIdentity(); void pending.catch(() => {}); return pending; }
async function nextAttempt() { await vi.advanceTimersByTimeAsync(300); }

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  delete googleWindow.google;
  ({ loadGoogleIdentity } = await import("./googleIdentitySdk"));
});
afterEach(() => {
  scripts().forEach((script) => script.remove());
  delete googleWindow.google;
  vi.useRealTimers();
});

test("a first script error retries automatically and resolves all waiting consumers", async () => {
  const pending = startLoad();
  const shared = loadGoogleIdentity();
  expect(shared).toBe(pending);
  scripts()[0].dispatchEvent(new Event("error"));
  await nextAttempt();
  expect(scripts()).toHaveLength(1);
  googleWindow.google = { accounts: { id: identity } };
  scripts()[0].dispatchEvent(new Event("load"));
  await expect(pending).resolves.toBe(identity);
  await expect(shared).resolves.toBe(identity);
  expect(vi.getTimerCount()).toBe(0);
});

test("a slow first load has thirty seconds before a bounded second attempt", async () => {
  const pending = startLoad();
  const initial = scripts()[0];
  await vi.advanceTimersByTimeAsync(29999);
  expect(scripts()[0]).toBe(initial);
  await vi.advanceTimersByTimeAsync(1);
  expect(initial.isConnected).toBe(false);
  await nextAttempt();
  expect(scripts()).toHaveLength(1);
  expect(scripts()[0]).not.toBe(initial);
  googleWindow.google = { accounts: { id: identity } };
  scripts()[0].dispatchEvent(new Event("load"));
  await expect(pending).resolves.toBe(identity);
});

test("late events from a timed-out script cannot replace the active shared retry", async () => {
  const pending = startLoad();
  const initial = scripts()[0];
  const lateLoad = initial.onload!;
  const lateError = initial.onerror!;
  await vi.advanceTimersByTimeAsync(30000);
  await nextAttempt();
  const retry = scripts()[0];
  lateLoad.call(initial, new Event("load"));
  lateError.call(initial, new Event("error"));
  expect(loadGoogleIdentity()).toBe(pending);
  expect(scripts()).toEqual([retry]);
  googleWindow.google = { accounts: { id: identity } };
  retry.dispatchEvent(new Event("load"));
  await expect(pending).resolves.toBe(identity);
});

test("two failed attempts settle and allow a new manual load without old-event interference", async () => {
  const pending = startLoad();
  const rejection = expect(pending).rejects.toThrow();
  const initial = scripts()[0];
  const lateError = initial.onerror!;
  initial.dispatchEvent(new Event("error"));
  await nextAttempt();
  expect(scripts()).toHaveLength(1);
  scripts()[0].dispatchEvent(new Event("error"));
  await rejection;
  expect(scripts()).toHaveLength(0);
  const fresh = loadGoogleIdentity();
  const freshScript = scripts()[0];
  lateError.call(initial, new Event("error"));
  expect(loadGoogleIdentity()).toBe(fresh);
  expect(scripts()).toEqual([freshScript]);
  googleWindow.google = { accounts: { id: identity } };
  freshScript.dispatchEvent(new Event("load"));
  await expect(fresh).resolves.toBe(identity);
});

test("a Google SDK that becomes ready during backoff is preserved without another script", async () => {
  const pending = startLoad();
  scripts()[0].dispatchEvent(new Event("error"));
  googleWindow.google = { accounts: { id: identity } };
  await nextAttempt();
  await expect(pending).resolves.toBe(identity);
  expect(scripts()).toHaveLength(0);
  expect(await loadGoogleIdentity()).toBe(identity);
});
