'use client';
import { useEffect, useRef, useState } from 'react';
import { resolveMenuDesign as generateDesign, type GenerateMenuDesignPayload } from '@cooking/api-client';
import { isMenuDesign, type MenuDesign } from '@cooking/shared';
import { useAuth } from '../../lib/auth';
import { webApiClient } from '../../lib/api';

/** Proposals never mutate the draft. Applying one is a separate editor action. */
export function useMenuDesign() {
  const { user } = useAuth();
  const account = user?.id;
  const identity = useRef(account); identity.current = account;
  const operation = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<MenuDesign | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  useEffect(() => {
    epoch.current++; operation.current?.abort(); operation.current = null;
    setBusy(false); setCandidate(null); setErrorKey(null);
    return () => { epoch.current++; operation.current?.abort(); operation.current = null; };
  }, [account]);
  async function generate(payload: GenerateMenuDesignPayload) {
    if (operation.current || !account || !payload.brief.trim()) return;
    const controller = new AbortController(); operation.current = controller;
    const owner = account; const version = ++epoch.current;
    const current = () => identity.current === owner && epoch.current === version && !controller.signal.aborted;
    setBusy(true); setErrorKey(null);
    try {
      const result = await generateDesign(webApiClient.menus, payload, { signal: controller.signal });
      if (!isMenuDesign(result)) throw new Error('Invalid design');
      if (current()) setCandidate(result);
    } catch (error) {
      if (current()) {
        const code = (error as { code?: string }).code;
        setErrorKey(code === 'ai_budget_exceeded' || code === 'global_ai_budget_exceeded' ? 'menu.studio.designBudget' : 'menu.studio.designFailed');
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (identity.current === owner && epoch.current === version) setBusy(false);
    }
  }
  return { busy, candidate, errorKey, generate,
    cancel() { epoch.current++; operation.current?.abort(); operation.current = null; setBusy(false); setErrorKey('menu.studio.designCancelled'); },
    discard() { setCandidate(null); },
  };
}
