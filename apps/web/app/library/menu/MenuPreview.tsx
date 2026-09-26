'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { buildMenuPreviewHtml, type MenuDraft, type MenuLayout, type MenuRendererAssets, type MenuRendererMessage } from '@cooking/shared';
import { useT } from '../../lib/i18n';
import styles from './MenuMaker.module.css';

export function isMenuRendererMessage(value: unknown, revision: number): value is MenuRendererMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== 'chefworld-menu' || message.revision !== revision) return false;
  if (message.type === 'error') return ['render-failed','export-failed'].includes(String(message.code)) && typeof message.message === 'string';
  if (message.type === 'png') return Number.isSafeInteger(message.pageIndex) && Number(message.pageIndex) >= 0 && typeof message.dataUrl === 'string' && message.dataUrl.length < 30_000_000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(message.dataUrl);
  if (message.type !== 'ready' || !message.layout || typeof message.layout !== 'object') return false;
  const layout = message.layout as MenuLayout;
  return layout.width === 816 && layout.height === 1056 && Array.isArray(layout.pages) && layout.pages.length > 0 && layout.pages.length === message.pageCount && layout.pages.every(page => page && Array.isArray(page.itemStarts) && page.itemStarts.every(id => typeof id === 'string') && Array.isArray(page.runs) && page.runs.every(run => run && typeof run.text === 'string' && typeof run.color === 'string' && ['MenuSerif','MenuSans','MenuCJK'].includes(run.family) && [400,600].includes(run.weight) && ['left','center','right'].includes(run.align) && [run.x,run.baseline,run.size,run.lineHeight].every(Number.isFinite)));
}
export type MenuPreviewHandle = { exportPng: (pageIndex: number) => void };
type Props = { draft: MenuDraft; assets: MenuRendererAssets; revision: number; pageIndex: number; onReady: (layout: MenuLayout, revision: number) => void; onPng: (dataUrl: string, pageIndex: number) => void; onError: (code: 'render-failed' | 'export-failed') => void };
export const MenuPreview = forwardRef<MenuPreviewHandle, Props>(function MenuPreview({ draft, assets, revision, pageIndex, onReady, onPng, onError }, ref) {
  const t = useT(); const iframe = useRef<HTMLIFrameElement>(null); const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5); const [pages, setPages] = useState(1);
  const [initial] = useState(() => ({ html: buildMenuPreviewHtml(draft, { ...assets, revision }), revision }));
  const latest = useRef({ draft, assets, revision, onReady, onPng, onError }); latest.current = { draft, assets, revision, onReady, onPng, onError };
  const sent = useRef({ revision: initial.revision, assets }); const loaded = useRef(false);
  function update() {
    if (!loaded.current || latest.current.revision <= sent.current.revision) return;
    const next = latest.current;
    const changedAssets = next.assets.fonts !== sent.current.assets.fonts ? next.assets : next.assets.artworkDataUrl !== sent.current.assets.artworkDataUrl ? { artworkDataUrl: next.assets.artworkDataUrl } : undefined;
    iframe.current?.contentWindow?.postMessage({ channel: 'chefworld-menu', type: 'render', revision: next.revision, draft: next.draft, ...(changedAssets ? { assets: changedAssets } : {}) }, '*');
    sent.current = { revision: next.revision, assets: next.assets };
  }
  useEffect(() => { update(); }, [draft, assets, revision]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== iframe.current?.contentWindow) return;
      let value: unknown = event.data;
      if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return; } }
      if (!isMenuRendererMessage(value, latest.current.revision)) return;
      if (value.type === 'ready') { setPages(value.pageCount); latest.current.onReady(value.layout, value.revision); }
      else if (value.type === 'png' && value.pageIndex < pages) latest.current.onPng(value.dataUrl, value.pageIndex);
      else if (value.type === 'error') latest.current.onError(value.code);
    }
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [pages]);
  useEffect(() => {
    const node = container.current; if (!node) return;
    const resize = () => setScale(node.clientWidth / 816);
    resize(); const observer = new ResizeObserver(resize); observer.observe(node); return () => observer.disconnect();
  }, []);
  useImperativeHandle(ref, () => ({ exportPng(index) {
    iframe.current?.contentWindow?.postMessage({ channel: 'chefworld-menu', type: 'export-png', revision: latest.current.revision, pageIndex: index }, '*');
  } }), []);
  return <div className={styles.previewViewport} ref={container} data-testid="menu-preview-viewport">
    <iframe ref={iframe} title={t('menu.preview.title')} sandbox="allow-scripts" srcDoc={initial.html} onLoad={() => { loaded.current = true; update(); }} style={{ width:816, height:pages * 1080, transform:`scale(${scale}) translateY(-${pageIndex * 1080}px)` }} />
  </div>;
});
