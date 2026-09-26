import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
const fonts: Readonly<Record<string, string>> = {
  'Inter-400.ttf': 'font/ttf', 'Inter-600.ttf': 'font/ttf',
  'SourceSerif4-400.ttf': 'font/ttf', 'SourceSerif4-600.ttf': 'font/ttf',
  'NotoSansCJKsc-Regular.otf': 'font/otf',
};
export async function GET(_request: Request, { params }: { params: Promise<{ font: string }> }) {
  const { font } = await params;
  if (!Object.hasOwn(fonts, font)) return new Response(null, { status: 404 });
  const root = path.basename(process.cwd()) === 'web' ? path.resolve(process.cwd(), '../..') : process.cwd();
  const bytes = await readFile(path.join(root, 'packages/shared/assets/menu-fonts', font));
  return new Response(bytes, { headers: { 'Content-Type': fonts[font], 'Content-Length': String(bytes.length), 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}
