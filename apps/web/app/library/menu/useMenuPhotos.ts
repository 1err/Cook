'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItem } from '@cooking/shared';
import { useAuth } from '../../lib/auth';
import { loadMenuRecipePhoto, normalizeMenuPhoto } from './menuPhotos';

type Entry = { source: string | null; image?: string; error?: string; attempted: boolean; suppressed: boolean; controller?: AbortController };
type Snapshot = { owner: string | null; sources: Record<string, string | null>; images: Record<string, string>; errors: Record<string, string>; loading: boolean };
const empty = (owner: string | null): Snapshot => ({ owner, sources: {}, images: {}, errors: {}, loading: false });

/** Ephemeral, account-scoped export pixels. Never persist photos or fetch edited URLs. */
export function useMenuPhotos(items: readonly MenuItem[]) {
  const { user } = useAuth(); const owner = user?.id ?? null;
  const identity = useRef(owner); identity.current = owner;
  const mounted = useRef(true);
  const signature = JSON.stringify(items.map(item => [item.recipeId, item.imageUrl || null]));
  const sources = useMemo(() => new Map<string, string | null>(JSON.parse(signature)), [signature]);
  const selected = useRef(sources); selected.current = sources;
  const store = useRef({ owner, entries: new Map<string, Entry>() });
  const scheduler = useRef(() => {});
  const [snapshot, setSnapshot] = useState(() => empty(owner));

  const publish = useCallback(() => {
    if (!mounted.current || store.current.owner !== identity.current) return;
    const next = empty(store.current.owner);
    for (const [id, entry] of store.current.entries) {
      next.sources[id] = entry.source;
      if (entry.image) next.images[id] = entry.image;
      if (entry.error) next.errors[id] = entry.error;
      if (entry.controller || (!entry.attempted && !entry.suppressed && entry.source)) next.loading = true;
    }
    setSnapshot(next);
  }, []);

  const run = useCallback(async (id: string, entry: Entry, task: (signal: AbortSignal) => Promise<string>) => {
    const account = store.current.owner;
    const controller = new AbortController(); entry.controller = controller; entry.attempted = true; entry.error = undefined;
    const current = () => mounted.current && identity.current === account && store.current.owner === account
      && store.current.entries.get(id) === entry && entry.controller === controller
      && selected.current.has(id) && selected.current.get(id) === entry.source;
    let timedOut = false;
    let abort = () => {};
    const cancellation = new Promise<never>((_, reject) => {
      abort = () => reject(Object.assign(new Error('Photo operation cancelled'), { name: 'AbortError' }));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    publish();
    try {
      // The race also bounds implementations that fail to honor AbortSignal.
      const image = await Promise.race([task(controller.signal), cancellation]);
      if (current() && !controller.signal.aborted) entry.image = image;
    } catch {
      if (current() && (!controller.signal.aborted || timedOut)) entry.error = 'menu.photos.failed';
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
      if (entry.controller === controller) entry.controller = undefined;
      if (mounted.current && identity.current === account) { publish(); scheduler.current(); }
    }
  }, [publish]);

  const pump = useCallback(() => {
    if (!mounted.current || !identity.current || store.current.owner !== identity.current) return;
    let active = [...store.current.entries.values()].filter(entry => entry.controller).length;
    for (const [id, entry] of store.current.entries) {
      if (active >= 3) break;
      if (!entry.source || entry.attempted || entry.suppressed || entry.controller) continue;
      active++;
      void run(id, entry, signal => loadMenuRecipePhoto(id, entry.source!, signal));
    }
  }, [run]);
  scheduler.current = pump;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const entry of store.current.entries.values()) entry.controller?.abort();
      // StrictMode replays effect setup after cleanup; old attempts must not block that new lifetime.
      store.current.entries.clear();
    };
  }, []);
  useEffect(() => {
    if (store.current.owner !== owner) {
      for (const entry of store.current.entries.values()) entry.controller?.abort();
      store.current = { owner, entries: new Map() };
    }
    for (const [id, entry] of store.current.entries) {
      if (!owner || !sources.has(id) || sources.get(id) !== entry.source) {
        entry.controller?.abort(); store.current.entries.delete(id);
      }
    }
    if (owner) for (const [id, source] of sources) {
      if (!store.current.entries.has(id)) store.current.entries.set(id, { source, attempted: false, suppressed: false });
    }
    publish(); pump();
  }, [owner, sources, publish, pump]);

  const upload = useCallback(async (id: string, file: File) => {
    if (!identity.current || store.current.owner !== identity.current || !selected.current.has(id)) return;
    const entry = store.current.entries.get(id); if (!entry) return;
    entry.controller?.abort(); entry.suppressed = true;
    await run(id, entry, signal => normalizeMenuPhoto(file, signal));
  }, [run]);
  const remove = useCallback((id: string) => {
    const entry = store.current.entries.get(id); if (!entry || store.current.owner !== identity.current) return;
    entry.controller?.abort(); entry.controller = undefined;
    entry.image = undefined; entry.error = undefined; entry.suppressed = true;
    publish(); pump();
  }, [publish, pump]);
  const retry = useCallback(() => {
    for (const entry of store.current.entries.values()) {
      if (entry.error && !entry.suppressed && !entry.controller) { entry.error = undefined; entry.attempted = false; }
    }
    publish(); pump();
  }, [publish, pump]);
  // Filter on render as well as in effects: a new account/source never sees one stale frame.
  const visible = useMemo(() => {
    if (!owner || snapshot.owner !== owner) return { images: {} as Record<string, string>, errors: {} as Record<string, string>, loading: false };
    const valid = (id: string) => sources.has(id) && sources.get(id) === snapshot.sources[id];
    return { images: Object.fromEntries(Object.entries(snapshot.images).filter(([id]) => valid(id))),
      errors: Object.fromEntries(Object.entries(snapshot.errors).filter(([id]) => valid(id))), loading: snapshot.loading };
  }, [owner, snapshot, sources]);
  return { ...visible, upload, remove, retry };
}
