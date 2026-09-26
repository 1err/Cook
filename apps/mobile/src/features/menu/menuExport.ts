import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

export class SharingUnavailableError extends Error {
  constructor() { super('Native sharing unavailable'); this.name = 'SharingUnavailableError'; }
}

/** Only the URI returned by this print operation is eligible for cleanup. */
export async function shareMenuPdf(html: string, expectedPages: number): Promise<void> {
  if (!Number.isSafeInteger(expectedPages) || expectedPages < 1) throw new Error('Invalid page count');
  if (!await Sharing.isAvailableAsync()) throw new SharingUnavailableError();
  let ownedUri: string | null = null;
  try {
    const output = await Print.printToFileAsync({
      html, width: 612, height: 792,
      margins: { top: 0, right: 0, bottom: 0, left: 0 }, textZoom: 100,
    });
    const cache = FileSystem.cacheDirectory;
    if (!cache || !output.uri.startsWith(cache) || !output.uri.endsWith('.pdf') || output.uri.includes('/../')) {
      throw new Error('Unexpected PDF location');
    }
    ownedUri = output.uri;
    if (output.numberOfPages !== expectedPages) throw new Error('PDF pagination differs from preview');
    await Sharing.shareAsync(output.uri, { mimeType: 'application/pdf', UTI: '.pdf' });
  } finally {
    if (ownedUri) await FileSystem.deleteAsync(ownedUri, { idempotent: true }).catch(() => undefined);
  }
}

export async function printMenu(html: string): Promise<void> {
  await Print.printAsync({ html });
}
