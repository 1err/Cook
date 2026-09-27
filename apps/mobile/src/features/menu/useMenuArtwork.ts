import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveMenuArtwork, type GenerateMenuArtworkPayload, type RecipeImageAccess } from '@cooking/api-client';
import { createUuid, type AcceptedMenuArtwork, type MenuStyleId, type MenuDesign } from '@cooking/shared';
import { useApiClient } from '../../lib/api';
import { artworkResponseDataUrl } from './menuAssets';

export type ArtworkCandidate = { metadata: AcceptedMenuArtwork; dataUrl: string; design?: MenuDesign };

export function menuArtworkErrorKey(code: unknown, fallback: 'failed' | 'unavailable' = 'failed'): string {
  switch (code) {
    case 'daily_limit': return 'menu.artwork.limitReached';
    case 'global_limit': return 'menu.artwork.globalLimit';
    case 'rate_limited': return 'imageGeneration.rateLimited';
    case 'membership_required': return 'menu.artwork.membershipRequired';
    case 'disabled':
    case 'unavailable': return 'menu.artwork.unavailable';
    default: return `menu.artwork.${fallback}`;
  }
}


export function useMenuArtwork() {
  const api = useApiClient();
  const active = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const request = useRef<GenerateMenuArtworkPayload | null>(null);
  const [access, setAccess] = useState<RecipeImageAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<ArtworkCandidate | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState(false);

  const refreshAccess = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api.menus.artworkAccess({ signal });
      if (active.current && !signal?.aborted) setAccess(result);
    } catch {
      if (active.current && !signal?.aborted) setErrorKey('menu.artwork.unavailable');
    }
  }, [api]);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void refreshAccess(controller.signal);
    return () => { active.current = false; epoch.current++; controller.abort(); operation.current?.abort(); };
  }, [refreshAccess]);

  const run = useCallback(async (payload: GenerateMenuArtworkPayload, mode: 'generate' | 'check') => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const version = ++epoch.current;
    const current = () => active.current && !controller.signal.aborted && epoch.current === version;
    setBusy(true); setErrorKey(null); setRecoverable(false);
    // The shared request helper also has its own portable 90-second deadline.
    // This one bounds authenticated byte retrieval after generation finishes.
    const deadline = setTimeout(() => {
      if (!current()) return;
      epoch.current++; controller.abort(); operation.current = null;
      setBusy(false); setRecoverable(true); setErrorKey('menu.artwork.failed');
    }, 90_000);
    try {
      const result = await resolveMenuArtwork(api.menus, payload, { mode, signal: controller.signal });
      if (!current()) return;
      if (result.status !== 'completed' || result.request_id !== payload.request_id) throw new Error('Generation failed');
      const response = await api.menus.artworkFile(payload.request_id, { signal: controller.signal });
      const dataUrl = await artworkResponseDataUrl(response);
      if (!current()) return;
      setCandidate({ dataUrl, ...(payload.design ? { design: payload.design } : {}), metadata: { requestId: payload.request_id, styleId: payload.style_id, instructions: payload.instructions } });
      setRecoverable(false);
    } catch (error) {
      if (!current()) return;
      const code = (error as { code?: string }).code;
      setErrorKey(menuArtworkErrorKey(code));
      setRecoverable(true);
    } finally {
      clearTimeout(deadline);
      if (operation.current === controller) operation.current = null;
      if (current()) { setBusy(false); void refreshAccess(); }
    }
  }, [api, refreshAccess]);

  return {
    access, busy, candidate, errorKey, recoverable,
    generate(styleId: MenuStyleId, instructions: string, design?: MenuDesign) {
      if (operation.current || !access?.allowed || instructions.length > 300) return;
      const payload: GenerateMenuArtworkPayload = { request_id: createUuid(), style_id: styleId, instructions, ...(design ? { design: JSON.parse(JSON.stringify(design)) as MenuDesign } : {}) };
      request.current = payload; setCandidate(null); void run(payload, 'generate');
    },
    check() { if (request.current) void run(request.current, 'check'); },
    cancel() {
      epoch.current++; operation.current?.abort(); operation.current = null;
      setBusy(false); setRecoverable(!!request.current); setErrorKey('menu.artwork.cancelled');
    },
    discard() { setCandidate(null); },
  };
}
