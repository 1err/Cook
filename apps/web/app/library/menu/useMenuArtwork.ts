'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveMenuArtwork, type GenerateMenuArtworkPayload, type RecipeImageAccess } from '@cooking/api-client';
import { createUuid, type AcceptedMenuArtwork, type MenuStyleId, type MenuDesign } from '@cooking/shared';
import { useAuth } from '../../lib/auth';
import { webApiClient } from '../../lib/api';
import { artworkResponseDataUrl } from './menuAssets';

export type ArtworkCandidate = { metadata: AcceptedMenuArtwork; dataUrl: string };
export function useMenuArtwork() {
  const { user } = useAuth(); const account = user?.id;
  const identity = useRef(account); identity.current = account;
  const operation = useRef<AbortController | null>(null); const epoch = useRef(0);
  const request = useRef<GenerateMenuArtworkPayload | null>(null);
  const [access, setAccess] = useState<RecipeImageAccess | null>(null);
  const [busy, setBusy] = useState(false); const [candidate, setCandidate] = useState<ArtworkCandidate | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null); const [recoverable, setRecoverable] = useState(false);
  const refreshAccess = useCallback(async (signal?: AbortSignal) => {
    const owner = account;
    try { const result = await webApiClient.menus.artworkAccess({ signal }); if (!signal?.aborted && identity.current === owner) setAccess(result); }
    catch { if (!signal?.aborted && identity.current === owner) setErrorKey('menu.artwork.unavailable'); }
  }, [account]);
  useEffect(() => {
    const abort = new AbortController(); request.current = null; epoch.current++; operation.current?.abort();
    setCandidate(null); setAccess(null); setBusy(false); setRecoverable(false); setErrorKey(null);
    void refreshAccess(abort.signal);
    return () => { abort.abort(); epoch.current++; operation.current?.abort(); };
  }, [refreshAccess]);
  const run = useCallback(async (payload: GenerateMenuArtworkPayload, mode: 'generate' | 'check') => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const version = ++epoch.current;
    const owner = account;
    const belongsToSession = () => identity.current === owner && epoch.current === version;
    const current = () => !controller.signal.aborted && belongsToSession();
    let timedOut = false;
    let rejectAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => {
        const error = new Error(timedOut ? 'Menu artwork operation timed out' : 'Menu artwork operation cancelled');
        error.name = 'AbortError';
        reject(error);
      };
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    // The shared resolver bounds provider recovery only. This deadline also
    // covers the authenticated file request and its entire streamed PNG body.
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90_000);
    setBusy(true);
    setErrorKey(null);
    setRecoverable(false);
    try {
      const retrieve = async () => {
        const result = await resolveMenuArtwork(webApiClient.menus, payload, { mode, signal: controller.signal });
        if (!current()) throw new Error('Menu artwork operation ended');
        if (result.status !== 'completed') throw new Error('Generation failed');
        const response = await webApiClient.menus.artworkFile(payload.request_id, { signal: controller.signal });
        if (!current()) throw new Error('Menu artwork operation ended');
        return artworkResponseDataUrl(response);
      };
      // Race as well as abort: a transport or body reader that ignores the
      // signal must not leave the editor busy forever or accept late bytes.
      const dataUrl = await Promise.race([retrieve(), cancelled]);
      if (!current()) return;
      setCandidate({ dataUrl, metadata: { requestId: payload.request_id, styleId: payload.style_id, instructions: payload.instructions } });
      setRecoverable(false);
    } catch (error) {
      if (!belongsToSession() || (controller.signal.aborted && !timedOut)) return;
      const code = (error as { code?: string }).code;
      setErrorKey(code === 'daily_limit' ? 'menu.artwork.limitReached' : code === 'global_limit' ? 'menu.artwork.globalLimit' : code === 'rate_limited' ? 'imageGeneration.rateLimited' : code === 'membership_required' ? 'menu.artwork.membershipRequired' : code === 'disabled' || code === 'unavailable' ? 'menu.artwork.unavailable' : 'menu.artwork.failed');
      setRecoverable(true);
    } finally {
      clearTimeout(deadline);
      controller.signal.removeEventListener('abort', rejectAbort);
      if (operation.current === controller) operation.current = null;
      if (belongsToSession()) {
        setBusy(false);
        void refreshAccess();
      }
    }
  }, [account, refreshAccess]);
  return {
    access, busy, candidate, errorKey, recoverable, refreshAccess,
    generate(styleId: MenuStyleId, instructions: string, design?: MenuDesign) {
      if (operation.current || !access?.allowed || instructions.length > 300) return;
      const payload: GenerateMenuArtworkPayload = { request_id: createUuid(), style_id: styleId, instructions, ...(design ? { design: structuredClone(design) } : {}) };
      request.current = payload; setCandidate(null); void run(payload, 'generate');
    },
    check() { if (request.current) void run(request.current, 'check'); },
    cancel() { epoch.current++; operation.current?.abort(); operation.current = null; setBusy(false); setRecoverable(!!request.current); setErrorKey('menu.artwork.cancelled'); },
    discard() { setCandidate(null); },
  };
}
