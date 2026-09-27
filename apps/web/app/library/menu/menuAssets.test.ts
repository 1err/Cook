import { describe, expect, it } from 'vitest';
import { artworkResponseDataUrl } from './menuAssets';
import { GET } from '../../menu-fonts/[font]/route';

describe('bounded menu assets',()=>{
 it('allows only the six bundled font filenames and rejects traversal/prototype names',async()=>{
  for(const font of ['../Inter-400.ttf','constructor','toString','NotoSansCJKsc-Regular.otf/../secret','.env']) {
   expect((await GET(new Request('https://example.test/menu-fonts/unused'),{params:Promise.resolve({font})})).status).toBe(404);
  }
  const response=await GET(new Request('https://example.test/menu-fonts/Inter-400.ttf'),{params:Promise.resolve({font:'Inter-400.ttf'})});
  const hand=await GET(new Request('https://example.test/menu-fonts/ZCOOLKuaiLe-Regular.ttf'),{params:Promise.resolve({font:'ZCOOLKuaiLe-Regular.ttf'})});
  expect(hand.status).toBe(200); expect((await hand.arrayBuffer()).byteLength).toBeGreaterThan(10000);
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('font/ttf');expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(10000);
 });
 it('rejects non-PNG, oversize declarations, and streams exceeding their declared size',async()=>{
  await expect(artworkResponseDataUrl(new Response('not a png',{headers:{'Content-Type':'image/png'}}))).rejects.toThrow('Invalid artwork bytes');
  await expect(artworkResponseDataUrl(new Response('',{headers:{'Content-Type':'image/svg+xml'}}))).rejects.toThrow('Invalid artwork format');
  await expect(artworkResponseDataUrl(new Response('',{headers:{'Content-Type':'image/png','Content-Length':String(21*1024*1024)}}))).rejects.toThrow('Asset unavailable');
  const stream=new ReadableStream({start(controller){for(let i=0;i<21;i++) controller.enqueue(new Uint8Array(1024*1024));controller.close();}});
  await expect(artworkResponseDataUrl(new Response(stream,{headers:{'Content-Type':'image/png','Content-Length':'100'}}))).rejects.toThrow('Asset too large');
 });
});
