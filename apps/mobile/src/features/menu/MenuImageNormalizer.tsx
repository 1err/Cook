import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export type MenuImageNormalizerHandle = { normalize(dataUrl: string, signal: AbortSignal): Promise<string> };
// The local document decodes only bytes supplied by this session. No URL, cookie,
// file access, or network request reaches the WebView.
export const MENU_IMAGE_NORMALIZER_HTML = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; connect-src 'none'"></head><body><script>
const seen=new Set();
async function receive(event){
 let value; try{value=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
 if(!value||typeof value.id!=='string'||typeof value.dataUrl!=='string'||value.dataUrl.length>15000000||!/^data:image\\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value.dataUrl)||seen.has(value.id))return;
 seen.add(value.id);
 try{
  const image=new Image();image.src=value.dataUrl;await image.decode();
  if(!image.width||!image.height||image.width*image.height>32000000)throw Error('image too large');
  const scale=Math.min(1,512/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const dataUrl=canvas.toDataURL('image/png');
  window.ReactNativeWebView.postMessage(JSON.stringify({id:value.id,dataUrl}));
 }catch{window.ReactNativeWebView.postMessage(JSON.stringify({id:value.id,error:true}));}
}
window.addEventListener('message',receive);document.addEventListener('message',receive);
</script></body></html>`;

type Job = { dataUrl: string; resolve(value: string): void; reject(error: Error): void; cleanup(): void };
export const MenuImageNormalizer = forwardRef<MenuImageNormalizerHandle>(function MenuImageNormalizer(_props, ref) {
  const webview = useRef<WebView>(null);
  const loaded = useRef(false);
  const jobs = useRef(new Map<string, Job>());
  const nextId = useRef(0);
  const send = (id: string, dataUrl: string) => webview.current?.postMessage(JSON.stringify({ id, dataUrl }));
  const failAll = () => { jobs.current.forEach(job => { job.cleanup(); job.reject(new Error('Image conversion unavailable')); }); jobs.current.clear(); };
  useEffect(() => () => { loaded.current = false; failAll(); }, []);
  useImperativeHandle(ref, () => ({
    normalize(dataUrl, signal) {
      if (signal.aborted) return Promise.reject(new Error('Cancelled'));
      return new Promise((resolve, reject) => {
        const id = String(++nextId.current);
        const cancel = () => { jobs.current.delete(id); cleanup(); reject(new Error('Image conversion cancelled')); };
        const timer = setTimeout(cancel, 20_000);
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
        jobs.current.set(id, { dataUrl, resolve, reject, cleanup });
        signal.addEventListener('abort', cancel, { once: true });
        if (loaded.current) send(id, dataUrl);
      });
    },
  }), []);
  return <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <WebView ref={webview} source={{ html: MENU_IMAGE_NORMALIZER_HTML }} originWhitelist={['*']}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
      mixedContentMode="never" incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      onLoadEnd={() => { loaded.current = true; jobs.current.forEach((job, id) => send(id, job.dataUrl)); }}
      onError={failAll} onContentProcessDidTerminate={failAll}
      onMessage={event => {
        let message: { id?: string; dataUrl?: string };
        try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
        const job = typeof message?.id === 'string' ? jobs.current.get(message.id) : undefined;
        if (!job) return;
        jobs.current.delete(message.id!); job.cleanup();
        if (typeof message.dataUrl !== 'string' || message.dataUrl.length > 2_000_000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(message.dataUrl)) job.reject(new Error('Invalid converted image'));
        else job.resolve(message.dataUrl);
      }} />
  </View>;
});
const styles = StyleSheet.create({ hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' } });
