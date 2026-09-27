import { useEffect, useRef, useState } from 'react';
import { resolveMenuDesign } from '@cooking/api-client';
import { isMenuDesign, type MenuDraft, type MenuDesign } from '@cooking/shared';
import { useApiClient } from '../../lib/api';

/** A proposal never mutates the current draft. Only explicit acceptance does. */
export function useMenuDesign() {
  const api = useApiClient();
  const operation = useRef<AbortController | null>(null);
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<MenuDesign | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; operation.current?.abort(); }; }, []);
  return {
    busy, candidate, errorKey,
    generate(menuCreationId: string, draft: MenuDraft, brief: string) {
      if (operation.current || !brief.trim() || brief.length > 1200) return;
      const controller = new AbortController(); operation.current = controller;
      setBusy(true); setCandidate(null); setErrorKey(null);
      const current = () => active.current && operation.current === controller && !controller.signal.aborted;
      void resolveMenuDesign(api.menus, {
        menu_creation_id: menuCreationId, brief: brief.trim(),
        content: { item_count: draft.items.length, section_count: draft.sections.length,
          photo_count: draft.items.filter(item => !!item.imageUrl).length,
          language: /\p{Script=Han}/u.test(draft.title + draft.items.map(item => item.name).join('')) ? 'zh' : 'en' },
      }, { signal: controller.signal }).then(design => {
        if (!current()) return;
        if (!isMenuDesign(design)) throw new Error('Invalid menu design');
        setCandidate(design);
      }).catch(() => { if (current()) setErrorKey('menu.studio.designFailed'); }).finally(() => {
        if (active.current && operation.current === controller) { operation.current = null; setBusy(false); }
      });
    },
    cancel() { operation.current?.abort(); operation.current = null; setBusy(false); setErrorKey('menu.studio.designCancelled'); },
    discard() { setCandidate(null); },
  };
}
