import type { MenuFontAsset } from '@cooking/shared';

export const MENU_FONT_FILES = [
  { file: 'Inter-400.ttf', family: 'MenuSans', weight: 400 },
  { file: 'Inter-600.ttf', family: 'MenuSans', weight: 600 },
  { file: 'SourceSerif4-400.ttf', family: 'MenuSerif', weight: 400 },
  { file: 'SourceSerif4-600.ttf', family: 'MenuSerif', weight: 600 },
  { file: 'NotoSansCJKsc-Regular.otf', family: 'MenuCJK', weight: 400 },
] as const;

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('Asset unavailable');
  if (!response.body) throw new Error('Empty asset');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Error('Asset too large'); chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function asDataUrl(bytes: Uint8Array, type: string): string {
  let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${type};base64,${btoa(value)}`;
}
let fontPromise: Promise<MenuFontAsset[]> | undefined;
export function loadMenuFonts(): Promise<MenuFontAsset[]> {
  fontPromise ??= Promise.all(MENU_FONT_FILES.map(async font => {
    const response = await fetch(`/menu-fonts/${font.file}`, { credentials: 'omit' });
    const bytes = await boundedBytes(response, 20 * 1024 * 1024);
    return { family: font.family, weight: font.weight, dataUrl: asDataUrl(bytes, font.file.endsWith('.otf') ? 'font/otf' : 'font/ttf') };
  })).catch(error => { fontPromise = undefined; throw error; });
  return fontPromise;
}
export async function artworkResponseDataUrl(response: Response): Promise<string> {
  if (response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error('Invalid artwork format');
  const bytes = await boundedBytes(response, 20 * 1024 * 1024);
  if (![137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) throw new Error('Invalid artwork bytes');
  return asDataUrl(bytes, 'image/png');
}
