import {expect,it} from 'vitest';
import {buildMenuPreviewHtml,buildMenuPrintHtml} from './html';
import {layoutMenu} from './layout';
import type { MenuDraft } from './types';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const draft:MenuDraft={title:'Dinner',subtitle:'',instructions:'',styleId:'cozy-cafe',sections:[],items:[],artwork:null};
const hostile='</script><img src=x onerror=alert(1)>" &\nhello';
it('escapes text in preview JSON and script-free printable SVG',()=>{
 const input={...draft,title:hostile};
 const assets={fonts:[],artworkDataUrl:null};
 const preview=buildMenuPreviewHtml(input,{...assets,revision:1});
 expect(preview).not.toContain(hostile);
 expect(preview).toContain('\\u003c/script>');
 const print=buildMenuPrintHtml(layoutMenu(input,t=>t.length*10),input,assets);
 expect(print).not.toMatch(/<script|<img src=x/);
 expect(print).toContain('&lt;/script&gt;');
 expect(print).toContain('size: 8.5in 11in');
 expect(print).toContain('break-after: auto');
});
it('rejects external images, script URLs, font CSS injection, and malformed data URLs',()=>{
 for(const artworkDataUrl of ['https://evil.test/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,<script>']) expect(()=>buildMenuPreviewHtml(draft,{fonts:[],artworkDataUrl,revision:0})).toThrow();
 expect(()=>buildMenuPreviewHtml(draft,{fonts:[{family:'bad\";}',weight:400,dataUrl:'data:font/ttf;base64,AA=='}],artworkDataUrl:null,revision:0})).toThrow();
});

it('keeps bundled native/browser source synchronized with the canonical renderer',()=>{
 expect(()=>execFileSync(process.execPath,[fileURLToPath(new URL('./generate-runtime.mjs',import.meta.url)),'--check'])).not.toThrow();
});
it('isolates preview and print from network and disallows scripts in print',()=>{
 const assets={fonts:[],artworkDataUrl:null};
 const preview=buildMenuPreviewHtml(draft,{...assets,revision:0});
 const print=buildMenuPrintHtml(layoutMenu(draft,t=>t.length*10),draft,assets);
 for(const html of [preview,print]){expect(html).toContain('http-equiv="Content-Security-Policy"');expect(html).toContain("default-src 'none'");expect(html).toContain("connect-src 'none'");expect(html).toContain('font-src data:');}
 expect(print).toContain("script-src 'none'");
});
