import { buildMenuPrintHtml, type MenuDraft, type MenuLayout, type MenuRendererAssets } from '@cooking/shared';

export function menuPngFilename(title: string, pageIndex: number): string {
  const name = title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'menu';
  return `${name}-page-${pageIndex + 1}.png`;
}
export function downloadMenuPng(dataUrl: string, title: string, pageIndex: number): void {
  if (!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(dataUrl)) throw new Error('Invalid PNG');
  const encoded = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = Uint8Array.from(encoded, char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = menuPngFilename(title, pageIndex);
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
export async function printMenu(layout: MenuLayout, draft: MenuDraft, assets: MenuRendererAssets): Promise<void> {
  // Open synchronously inside the click handler, before any promise boundary.
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('popup-blocked');
  let active = true;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof setInterval> | undefined;
  try {
    popup.opener = null;
    popup.document.open();
    popup.document.write(buildMenuPrintHtml(layout, draft, assets));
    popup.document.close();
    popup.document.title = draft.title;
    const cancelled = new Promise<never>((_, reject) => {
      // Timers belong to the opener. A closed or background popup may never
      // deliver its own animation frames or finish font promises.
      watcher = setInterval(() => {
        if (popup.closed) {
          active = false;
          reject(new Error('Print window closed'));
        }
      }, 100);
      deadline = setTimeout(() => {
        active = false;
        reject(new Error('Print preparation timed out'));
      }, 30_000);
    });
    const prepare = async () => {
      await Promise.all(assets.fonts.map(font => popup.document.fonts.load(`${font.weight} 20px "${font.family}"`)));
      await popup.document.fonts.ready;
      if (!active) return;
      await Promise.all([assets.artworkDataUrl, ...Object.values(assets.itemImages ?? {})].filter((url): url is string => !!url).map(async url => {
        const image = new Image();
        image.src = url;
        await image.decode();
      }));
      if (!active) return;
      await new Promise<void>(resolve => popup.requestAnimationFrame(() => {
        if (!active) { resolve(); return; }
        popup.requestAnimationFrame(() => resolve());
      }));
    };
    await Promise.race([prepare(), cancelled]);
    if (!active || popup.closed) throw new Error('Print window closed');
    popup.focus();
    popup.print();
  } catch (error) {
    if (!popup.closed) popup.close();
    throw error;
  } finally {
    active = false;
    clearTimeout(deadline);
    clearInterval(watcher);
  }
}
