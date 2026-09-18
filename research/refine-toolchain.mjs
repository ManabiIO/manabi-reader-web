import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=process.cwd();
const require=createRequire(path.join(root,'package.json'));
const {parse}=require('svelte/compiler');
const visit=(v,fn)=>{if(!v||typeof v!=='object')return;fn(v);for(const [k,c]of Object.entries(v)){if(k==='parent')continue;if(Array.isArray(c))c.forEach(e=>visit(e,fn));else if(c&&typeof c==='object')visit(c,fn);}};
const walk=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const voids=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
for(const p of walk(path.join(root,'apps/web/src')).filter(p=>p.endsWith('.svelte'))){
 const s=fs.readFileSync(p,'utf8');const ast=parse(s);const edits=[];
 visit(ast.html,n=>{if(n.type==='Element'&&/^[a-z][a-z0-9-]*$/.test(n.name)&&!voids.has(n.name)&&s.slice(n.start,n.end).endsWith('/>'))edits.push({at:n.end-2,text:`></${n.name}>`});});
 if(edits.length){let out=s;for(const e of edits.sort((a,b)=>b.at-a.at))out=out.slice(0,e.at)+e.text+out.slice(e.at+2);fs.writeFileSync(p,out);}
}
function edit(rel,fn){const p=path.join(root,rel);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
edit('apps/web/svelte.config.js',s=>s.replace('  compilerOptions: { immutable: true },\n',''));
edit('apps/web/src/lib/components/book-reader/book-reader-paginated/book-reader-paginated.svelte',s=>s.replace("direction: 'top' | 'right' | 'left' | 'bottom'", "direction: 'top' | 'right' | 'left' | 'bottom' | null"));
edit('apps/web/src/routes/b/+page.svelte',s=>s.replace('<button class="fixed inset-x-0 top-0 z-10 h-8 w-full"','<button aria-label="Show reading controls" class="fixed inset-x-0 top-0 z-10 h-8 w-full"').replace('    class="fixed left-0 z-10 w-5"',`    aria-label={$verticalMode$ ? 'Next page' : 'Previous page'}\n    class="fixed left-0 z-10 w-5"`).replace('    class="fixed right-0 z-10 w-5"',`    aria-label={$verticalMode$ ? 'Previous page' : 'Next page'}\n    class="fixed right-0 z-10 w-5"`));
edit('apps/web/src/lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery.svelte',s=>s.replace("            if (window.matchMedia('(min-width: 1024px)').matches) {", "            if (showSpoiler) {\n              toggleGalleryPictureSpoiler(readerImageGalleryPicture.url);\n            } else if (window.matchMedia('(min-width: 1024px)').matches) {").replace('          class="flex justify-center my-4"','          aria-label={showSpoiler ? \'Show hidden image\' : \'Select image\'}\n          class="flex justify-center my-4"').replace(`            <button\n              title="Show Image"\n              class="spoiler-label"\n              aria-hidden="true"\n              on:click={() => toggleGalleryPictureSpoiler(readerImageGalleryPicture.url)}\n            >\n              ネタバレ\n            </button>`,`            <span class="spoiler-label" aria-hidden="true">ネタバレ</span>`));
edit('apps/web/src/lib/service-worker/reader-service-worker.mjs',s=>s.replace(`event.respondWith(storage.open(config.userFontsCacheName).then(async (cache) =>\n        (await cache.match(url.pathname)) ?? new Response(null, {status: 404})));`,`event.respondWith(readUserFont(url.origin + url.pathname));`));
edit('apps/web/src/app.html',s=>s.replace(', maximum-scale=1, minimum-scale=1','').replace('maximum-scale=1, minimum-scale=1, ','').replace(/,\s*(?:maximum|minimum)-scale=1/g,''));
for(const rel of ['test/reader/run.mjs','test/reader/build-security-fixture.mjs'])if(fs.existsSync(path.join(root,rel)))edit(rel,s=>s.replace("const { build } = createRequire(appRequire.resolve('vite/package.json'))('esbuild');", "const { build } = createRequire(new URL('../../package.json', import.meta.url))('esbuild');"));
for(const mode of ['continuous','paginated'])edit(`apps/web/src/lib/components/book-reader/book-reader-${mode}/book-reader-${mode}.svelte`,s=>s.replace("@import '../styles'", "@use '../styles' as *"));
