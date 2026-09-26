import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import type { MenuFontAsset } from '@cooking/shared';

// Metro bundles file references, not font bytes. Bytes live only in the active editor.
const fonts = [
  { module: require('../../../../../packages/shared/assets/menu-fonts/Inter-400.ttf'), family: 'MenuSans', weight: 400, type: 'ttf' },
  { module: require('../../../../../packages/shared/assets/menu-fonts/Inter-600.ttf'), family: 'MenuSans', weight: 600, type: 'ttf' },
  { module: require('../../../../../packages/shared/assets/menu-fonts/SourceSerif4-400.ttf'), family: 'MenuSerif', weight: 400, type: 'ttf' },
  { module: require('../../../../../packages/shared/assets/menu-fonts/SourceSerif4-600.ttf'), family: 'MenuSerif', weight: 600, type: 'ttf' },
  { module: require('../../../../../packages/shared/assets/menu-fonts/NotoSansCJKsc-Regular.otf'), family: 'MenuCJK', weight: 400, type: 'otf' },
] as const;

export async function loadMenuFonts(): Promise<MenuFontAsset[]> {
  return Promise.all(fonts.map(async font => {
    const asset = Asset.fromModule(font.module);
    if (!asset.localUri) await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Font unavailable');
    const bytes = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
    return { family: font.family, weight: font.weight, dataUrl: `data:font/${font.type};base64,${bytes}` };
  }));
}

export async function artworkResponseDataUrl(response: Response): Promise<string> {
  const limit = 20 * 1024 * 1024;
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'image/png' || Number(response.headers.get('content-length')) > limit) {
    throw new Error('Artwork unavailable');
  }
  // React Native's fetch response has no ReadableStream; the authenticated server
  // endpoint enforces the same byte cap before returning the body.
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > limit || ![137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) {
    throw new Error('Invalid artwork bytes');
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:image/png;base64,${btoa(binary)}`;
}
