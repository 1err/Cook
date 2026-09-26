import { artworkResponseDataUrl, loadMenuFonts } from './menuAssets';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn(() => ({ localUri: 'file:///cache/font.ttf', downloadAsync: jest.fn() })) } }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn(async () => 'YWJj'), EncodingType: { Base64: 'base64' } }));
const png = new Uint8Array([137,80,78,71,13,10,26,10]);
function response(bytes = png, type = 'image/png', size = String(bytes.length)) {
  return { ok: true, headers: { get: (key: string) => key === 'content-type' ? type : size }, arrayBuffer: jest.fn(async () => bytes.buffer) } as unknown as Response;
}
test('loads all bundled fonts through local assets and file-system bytes', async () => {
  const fonts = await loadMenuFonts();
  expect(fonts).toHaveLength(5);
  expect(fonts.find(font => font.family === 'MenuCJK')?.dataUrl).toBe('data:font/otf;base64,YWJj');
  expect(Asset.fromModule).toHaveBeenCalledTimes(5);
  expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('file:///cache/font.ttf', { encoding: 'base64' });
});
test('accepts bounded authenticated PNG response bytes without needing Blob/FileReader', async () => {
  await expect(artworkResponseDataUrl(response())).resolves.toBe('data:image/png;base64,iVBORw0KGgo=');
});
test('rejects wrong MIME, oversized header and invalid PNG signature', async () => {
  await expect(artworkResponseDataUrl(response(png, 'image/jpeg'))).rejects.toThrow();
  const tooBig = response(png, 'image/png', '99999999');
  await expect(artworkResponseDataUrl(tooBig)).rejects.toThrow();
  expect(tooBig.arrayBuffer).not.toHaveBeenCalled();
  await expect(artworkResponseDataUrl(response(new Uint8Array([1,2,3])))).rejects.toThrow();
});
