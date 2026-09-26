import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { shareMenuPdf, printMenu, SharingUnavailableError } from './menuExport';

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(), printAsync: jest.fn() }), { virtual: true });
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }), { virtual: true });
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', deleteAsync: jest.fn(async () => undefined) }));
const html = '<html><img src="data:image/png;base64,iVBORw0KGgo="><p>家常菜单</p></html>';
beforeEach(() => {
  jest.clearAllMocks();
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Print.printToFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///cache/Print/menu.pdf', numberOfPages: 3 });
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
});
test('prints US Letter without margins, shares a PDF and cleans only its returned cache file', async () => {
  await shareMenuPdf(html, 3);
  expect(Print.printToFileAsync).toHaveBeenCalledWith({ html, width: 612, height: 792, margins: { top: 0, right: 0, bottom: 0, left: 0 }, textZoom: 100 });
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/Print/menu.pdf', { mimeType: 'application/pdf', UTI: '.pdf' });
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/Print/menu.pdf', { idempotent: true });
});
test('rejects mismatched pagination without sharing and still cleans its file', async () => {
  await expect(shareMenuPdf(html, 2)).rejects.toThrow();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});
test('cleans after share cancellation/failure and allows a retry', async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('cancelled'));
  await expect(shareMenuPdf(html, 3)).rejects.toThrow('cancelled');
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  await expect(shareMenuPdf(html, 3)).resolves.toBeUndefined();
});
test('offers an explicit print fallback when native sharing is unavailable', async () => {
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
  await expect(shareMenuPdf(html, 3)).rejects.toBeInstanceOf(SharingUnavailableError);
  expect(Print.printAsync).not.toHaveBeenCalled();
  await printMenu(html);
  expect(Print.printAsync).toHaveBeenCalledWith({ html });
});
test('never deletes non-cache files even if a native module returns one', async () => {
  (Print.printToFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///documents/unrelated.pdf', numberOfPages: 3 });
  await expect(shareMenuPdf(html, 3)).rejects.toThrow();
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
