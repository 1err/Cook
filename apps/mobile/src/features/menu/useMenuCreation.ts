import { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuCreationAccess } from '@cooking/api-client';
import { createUuid } from '@cooking/shared';
import { useApiClient } from '../../lib/api';

export function useMenuCreation() {
  const api = useApiClient();
  const [requestId] = useState(createUuid);
  const active = useRef(true);
  const admitted = useRef(false);
  const attempted = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [access, setAccess] = useState<MenuCreationAccess | null>(null);
  const accessRef = useRef(access); accessRef.current = access;
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const controllers = useRef(new Set<AbortController>());

  const bounded = useCallback(async <T,>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController(); controllers.current.add(controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      return await Promise.race([run(controller.signal), new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('cancelled'));
        controller.signal.addEventListener('abort', cancel, { once: true });
        timeout = setTimeout(() => controller.abort(), 30_000);
      })]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (cancel) controller.signal.removeEventListener('abort', cancel);
      controllers.current.delete(controller);
    }
  }, []);
  const refresh = useCallback(async () => {
    if (active.current) setChecking(true);
    try {
      const next = await bounded(signal => api.menus.access({ signal }));
      if (active.current) {
        setAccess(admitted.current && !next.is_admin ? { ...next, allowed: false, remaining: 0 } : next);
        setErrorKey(current => current === 'menu.creation.failed' ? current : null);
      }
    } catch {
      if (active.current) setErrorKey('menu.creation.unavailable');
    } finally { if (active.current) setChecking(false); }
  }, [api, bounded]);
  useEffect(() => {
    active.current = true; void refresh();
    return () => { active.current = false; controllers.current.forEach(controller => controller.abort()); };
  }, [refresh]);

  const ensure = useCallback((): Promise<boolean> => {
    if (admitted.current) return Promise.resolve(true);
    if (inFlight.current) return inFlight.current;
    // After an ambiguous response, retry the original ID even if its successful
    // write has already consumed today's allowance on the server.
    if (accessRef.current && !accessRef.current.allowed && !attempted.current) return Promise.resolve(false);
    attempted.current = true; setBusy(true); setErrorKey(null);
    const operation = (async () => {
      try {
        const result = await bounded(signal => api.menus.create({ request_id: requestId }, { signal }));
        if (!active.current) return false;
        if (result.request_id !== requestId) throw new Error('Invalid admission response');
        admitted.current = true;
        setAccess(current => current && !current.is_admin ? { ...current, allowed: false, remaining: 0 } : current);
        return true;
      } catch (error) {
        if (active.current) {
          if ((error as { code?: string }).code === 'menu_daily_limit') {
            attempted.current = false;
            setAccess(current => current ? { ...current, allowed: false, remaining: 0 } : { allowed: false, is_admin: false, daily_limit: 1, remaining: 0, resets_at: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString() });
            setErrorKey('menu.creation.limitReached');
          } else setErrorKey('menu.creation.failed');
        }
        return false;
      } finally { inFlight.current = null; if (active.current) setBusy(false); }
    })();
    inFlight.current = operation;
    return operation;
  }, [api, bounded, requestId]);

  const reset = access?.resets_at ? new Date(access.resets_at).toLocaleString() : '';
  return { access, busy, checking, errorKey, reset, ensure, refresh, admitted: admitted.current,
    canContinue: !busy && (admitted.current || attempted.current || !checking && access?.allowed !== false) };
}
