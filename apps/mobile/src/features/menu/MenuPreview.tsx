import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildMenuPreviewHtml, type MenuDraft, type MenuLayout, type MenuRendererAssets, type MenuRendererMessage } from '@cooking/shared';
import { useT } from '../../lib/i18n';

/** Accept only the current render and fully shaped measured layouts from our document. */
export function isMenuRendererMessage(value: unknown, revision: number): value is MenuRendererMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.channel !== 'chefworld-menu' || message.revision !== revision) return false;
  if (message.type === 'error') return ['render-failed', 'export-failed'].includes(String(message.code)) && typeof message.message === 'string';
  if (message.type !== 'ready' || !message.layout || typeof message.layout !== 'object') return false;
  const layout = message.layout as MenuLayout;
  return layout.width === 816 && layout.height === 1056 && Array.isArray(layout.pages) && layout.pages.length > 0 && layout.pages.length === message.pageCount && layout.pages.every(page => page && Array.isArray(page.itemStarts) && page.itemStarts.every(id => typeof id === 'string') && Array.isArray(page.runs) && page.runs.every(run => run && typeof run.text === 'string' && typeof run.color === 'string' && (run.itemId === undefined || typeof run.itemId === 'string') && ['MenuSerif', 'MenuSans', 'MenuCJK'].includes(run.family) && [400, 600].includes(run.weight) && ['left', 'center', 'right'].includes(run.align) && [run.x, run.baseline, run.size, run.lineHeight].every(Number.isFinite)));
}

type Props = { draft: MenuDraft; assets: MenuRendererAssets; revision: number; pageIndex: number; onReady: (layout: MenuLayout, revision: number) => void; onError: () => void };
export function MenuPreview({ draft, assets, revision, pageIndex, onReady, onError }: Props) {
  const t = useT();
  const webview = useRef<WebView>(null);
  const [width, setWidth] = useState(320);
  const [initial] = useState(() => ({ source: { html: buildMenuPreviewHtml(draft, { ...assets, revision }) }, revision }));
  const latest = useRef({ draft, assets, revision, onReady, onError });
  latest.current = { draft, assets, revision, onReady, onError };
  const sent = useRef({ revision: initial.revision, assets });
  const loaded = useRef(false);

  const update = () => {
    const next = latest.current;
    if (!loaded.current || next.revision <= sent.current.revision) return;
    const changedAssets = next.assets.fonts !== sent.current.assets.fonts ? next.assets : next.assets.artworkDataUrl !== sent.current.assets.artworkDataUrl ? { artworkDataUrl: next.assets.artworkDataUrl } : undefined;
    webview.current?.postMessage(JSON.stringify({ channel: 'chefworld-menu', type: 'render', revision: next.revision, draft: next.draft, ...(changedAssets ? { assets: changedAssets } : {}) }));
    sent.current = { revision: next.revision, assets: next.assets };
  };
  useEffect(() => { const timer = setTimeout(update, 200); return () => clearTimeout(timer); }, [draft, assets, revision]);
  useEffect(() => {
    webview.current?.injectJavaScript(`window.scrollTo(0,${Math.max(0, Math.trunc(pageIndex)) * 1080});true;`);
  }, [pageIndex, revision]);

  const receive = (event: WebViewMessageEvent) => {
    let value: unknown;
    try { value = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!isMenuRendererMessage(value, latest.current.revision)) return;
    if (value.type === 'ready') {
      latest.current.onReady(value.layout, value.revision);
      webview.current?.injectJavaScript(`window.scrollTo(0,${Math.max(0, Math.trunc(pageIndex)) * 1080});true;`);
    } else if (value.type === 'error') latest.current.onError();
  };
  return <View style={styles.frame} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <WebView ref={webview} source={initial.source} style={{ width: '100%', height: width * 1056 / 816, backgroundColor: 'transparent' }}
      accessibilityLabel={t('menu.preview.title')} originWhitelist={['*']}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
      mixedContentMode="never" incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      scrollEnabled={false} bounces={false} scalesPageToFit onMessage={receive}
      onLoadEnd={() => { loaded.current = true; update(); }} onError={() => latest.current.onError()}
      onContentProcessDidTerminate={() => latest.current.onError()} />
  </View>;
}
const styles = StyleSheet.create({ frame: { width: '100%', overflow: 'hidden', borderRadius: 8 } });
