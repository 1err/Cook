import { useEffect, useRef, useState } from 'react';
import type { MenuItem } from '@cooking/shared';
import { useApiClient } from '../../lib/api';

export async function menuPhotoResponseDataUrl(response: Response): Promise<string> {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const limit = 10 * 1024 * 1024;
  if (!response.ok || !type || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type) || Number(response.headers.get('content-length')) > limit) throw new Error('Image unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const starts = (values: number[]) => values.every((value, index) => bytes[index] === value);
  const valid = type === 'image/png' ? starts([137,80,78,71,13,10,26,10]) : type === 'image/jpeg' ? starts([255,216,255]) : type === 'image/gif' ? starts([71,73,70,56]) : starts([82,73,70,70]) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
  if (!valid || bytes.length > limit) throw new Error('Invalid image');
  let binary = ''; for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:${type};base64,${btoa(binary)}`;
}

export function publicMenuPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && url.hostname.includes('.') && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname) && !/\.(local|localhost|internal)$/i.test(url.hostname);
  } catch { return false; }
}

type Normalize = (dataUrl: string, signal: AbortSignal) => Promise<string>;
export function useMenuPhotos(items: readonly MenuItem[], normalize: Normalize) {
  const api = useApiClient();
  const [itemImages, setItemImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, string>());
  const manifest = JSON.stringify(items.filter(item => !!item.imageUrl).map(item => ({ recipeId: item.recipeId, imageUrl: item.imageUrl! })));
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    const selected = JSON.parse(manifest) as { recipeId: string; imageUrl: string }[];
    const images: Record<string, string> = {}; let failures = 0, cursor = 0;
    setLoading(selected.length > 0); setFailed(0);
    const run = async () => {
      while (cursor < selected.length && current) {
        const item = selected[cursor++]; const key = `${item.recipeId}:${item.imageUrl}`;
        try {
          let image = cache.current.get(key);
          if (!image) {
            const operation = new AbortController();
            const abort = () => operation.abort(); controller.signal.addEventListener('abort', abort, { once: true });
            let cancel: (() => void) | undefined;
            const timer = setTimeout(abort, 30_000);
            try {
              image = await Promise.race([(async () => {
                let response: Response;
                try { response = await api.menus.recipeImage(item.recipeId, { signal: operation.signal }); }
                catch (error) {
                  if ((error as { status?: number }).status !== 404 || !publicMenuPhotoUrl(item.imageUrl)) throw error;
                  response = await fetch(item.imageUrl, { signal: operation.signal, credentials: 'omit', headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' } });
                  if (response.url && !publicMenuPhotoUrl(response.url)) throw new Error('Invalid redirect');
                }
                return normalize(await menuPhotoResponseDataUrl(response), operation.signal);
              })(), new Promise<never>((_, reject) => { cancel = () => reject(new Error('Image timed out')); operation.signal.addEventListener('abort', cancel, { once: true }); })]);
            } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); if (cancel) operation.signal.removeEventListener('abort', cancel); }
            if (!current) return;
            cache.current.set(key, image);
          }
          images[item.recipeId] = image;
        } catch { if (current) failures++; }
      }
    };
    void Promise.all([run(), run()]).then(() => {
      if (!current) return;
      const activeKeys = new Set(selected.map(item => `${item.recipeId}:${item.imageUrl}`));
      for (const key of cache.current.keys()) if (!activeKeys.has(key)) cache.current.delete(key);
      setItemImages(images); setFailed(failures); setLoading(false);
    });
    return () => { current = false; controller.abort(); };
  }, [api, manifest, normalize, attempt]);
  return { itemImages, loading, failed, retry: () => setAttempt(value => value + 1) };
}
