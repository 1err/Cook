import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FULL_MENU_RECIPE_LIMIT, resolveMenuArtwork, type GenerateFullMenuPayload, type MenuCreationAccess, type RecipeImageAccess } from '@cooking/api-client';
import { createUuid } from '@cooking/shared';
import { useApiClient } from '../../lib/api';
import { artworkResponseDataUrl } from './menuAssets';

function errorKey(code: unknown) {
  switch (code) {
    case 'menu_daily_limit': return 'menu.creation.limitReached';
    case 'daily_limit': return 'menu.simple.imageLimit';
    case 'global_limit': return 'menu.simple.unavailable';
    case 'rate_limited': return 'imageGeneration.rateLimited';
    case 'membership_required': return 'menu.simple.membershipRequired';
    case 'recipe_not_found': case 'recipe_changed': case 'recipe_selection_changed': return 'menu.simple.selectionChanged';
    case 'disabled': case 'unavailable': return 'menu.simple.unavailable';
    default: return 'menu.simple.failed';
  }
}

/** This hook never admits a menu separately or retries paid work automatically. */
export function useFullMenu() {
  const api = useApiClient();
  const active = useRef(true);
  const epoch = useRef(0);
  const request = useRef<GenerateFullMenuPayload | null>(null);
  const requestReset = useRef<string | null>(null);
  const admittedUntil = useRef<string | null>(null);
  const operation = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const accessOperation = useRef<AbortController | null>(null);
  const [access, setAccess] = useState<MenuCreationAccess | null>(null);
  const accessRef = useRef(access); accessRef.current = access;
  const [imageAccess, setImageAccess] = useState<RecipeImageAccess | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    accessOperation.current?.abort();
    const controller = new AbortController(); accessOperation.current = controller;
    const current = () => active.current && !controller.signal.aborted && accessOperation.current === controller;
    setCheckingAccess(true); setAccessError(false);
    const timeout = setTimeout(() => {
      if (!current()) return;
      controller.abort(); setCheckingAccess(false); setAccessError(true);
    }, 30_000);
    try {
      const [creation, images] = await Promise.all([api.menus.access({ signal: controller.signal }), api.menus.artworkAccess({ signal: controller.signal })]);
      if (current()) {
        const effective = admittedUntil.current === creation.resets_at && !creation.is_admin ? { ...creation, allowed: false, remaining: 0 } : creation;
        setAccess(effective); setImageAccess(images);
        setError(value => value === 'menu.creation.limitReached' && effective.allowed || value === 'menu.simple.imageLimit' && images.allowed ? null : value);
      }
    } catch { if (current()) setAccessError(true); }
    finally { clearTimeout(timeout); if (current()) setCheckingAccess(false); }
  }, [api]);

  useEffect(() => {
    active.current = true; void refresh();
    return () => {
      active.current = false; epoch.current++; accessOperation.current?.abort();
      if (operation.current) { clearTimeout(operation.current.timer); operation.current.controller.abort(); operation.current = null; }
    };
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && active.current) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    const resets = [access?.resets_at, imageAccess?.resets_at].map(value => value ? Date.parse(value) : NaN).filter(Number.isFinite);
    if (!resets.length) return;
    // At most one read-only refresh per reported reset. A one-second margin
    // avoids clock-boundary races; foregrounding also refreshes suspended apps.
    const delay = Math.max(1_000, Math.min(86_400_000, Math.min(...resets) - Date.now() + 1_000));
    const timer = setTimeout(() => { if (active.current) void refresh(); }, delay);
    return () => clearTimeout(timer);
  }, [access?.resets_at, imageAccess?.resets_at, refresh]);

  const run = useCallback(async (payload: GenerateFullMenuPayload, mode: 'generate' | 'check') => {
    if (operation.current) return;
    const controller = new AbortController();
    const version = ++epoch.current;
    const current = () => active.current && !controller.signal.aborted && epoch.current === version;
    setBusy(true); setChecking(mode === 'check'); setRecoverable(false); setError(null);
    const timer = setTimeout(() => {
      if (!current()) return;
      epoch.current++; controller.abort(); operation.current = null;
      setBusy(false); setChecking(false); setRecoverable(true); setError('menu.simple.failed');
    }, 270_000);
    operation.current = { controller, timer };
    try {
      const status = await resolveMenuArtwork(api.menus, payload, { mode, signal: controller.signal });
      if (!current()) return;
      if (status.request_id !== payload.request_id) throw new Error('Unexpected menu request');
      admittedUntil.current = requestReset.current;
      if (status.status === 'failed') { setError('menu.simple.terminalFailed'); setRecoverable(false); return; }
      if (status.status !== 'completed') throw new Error('Menu not ready');
      const response = await api.menus.artworkFile(payload.request_id, { signal: controller.signal });
      const dataUrl = await artworkResponseDataUrl(response);
      if (!current()) return;
      setResult(dataUrl); setRecoverable(false);
    } catch (failure) {
      if (!current()) return;
      const { code, status } = (failure ?? {}) as { code?: string; status?: number };
      const definitive = typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && (status !== 404 || code === 'recipe_not_found');
      setError(errorKey(code)); setRecoverable(!definitive);
      if (code === 'menu_daily_limit') { admittedUntil.current = accessRef.current?.resets_at ?? null; setAccess(value => value ? { ...value, allowed: false, remaining: 0 } : value); }
    } finally {
      clearTimeout(timer);
      if (operation.current?.controller === controller) operation.current = null;
      if (current()) { setBusy(false); setChecking(false); void refresh(); }
    }
  }, [api, refresh]);

  const allowed = !checkingAccess && !accessError && access?.allowed === true && imageAccess?.allowed === true;
  return {
    access, imageAccess, checkingAccess, accessError, busy, checking, recoverable, error, result, allowed, refresh,
    accessErrorKey: !checkingAccess && imageAccess && !imageAccess.allowed ? errorKey(imageAccess.reason) : null,
    generate(input: Omit<GenerateFullMenuPayload, 'request_id' | 'mode'>) {
      if (operation.current || recoverable || !allowed || !input.recipes.length || input.recipes.length > FULL_MENU_RECIPE_LIMIT ||
        new Set(input.recipes.map(recipe => recipe.recipe_id)).size !== input.recipes.length || input.recipes.some(recipe => !recipe.name.trim()) ||
        (input.title?.length ?? 0) > 120 || (input.brief?.length ?? 0) > 1200) return;
      const payload: GenerateFullMenuPayload = {
        request_id: createUuid(), mode: 'full-menu-v1',
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
        recipes: input.recipes.map(recipe => ({ ...recipe })),
      };
      request.current = payload; requestReset.current = accessRef.current?.resets_at ?? null; setResult(null); void run(payload, 'generate');
    },
    check() { if (request.current && recoverable) void run(request.current, 'check'); },
    cancel() {
      epoch.current++;
      if (operation.current) { clearTimeout(operation.current.timer); operation.current.controller.abort(); operation.current = null; }
      setBusy(false); setChecking(false); setRecoverable(!!request.current); setError(null);
    },
  };
}
