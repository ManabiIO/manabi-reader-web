"""Research composition only. The resulting normal-history PR contains source, not this helper."""
from pathlib import Path
import json,re,subprocess
subprocess.run(['git','fetch','--depth=1','origin','bca91f6fff6300d10ba47d046dfb1a20a7c97e5e'],check=True)

def edit(name,old,new):
    p=Path(name);s=p.read_text();assert s.count(old)==1,(name,old,s.count(old));p.write_text(s.replace(old,new))

edit('apps/web/src/routes/+layout.svelte',"  import ManabiRuntime from '$lib/manabi/runtime.svelte';","  import ManabiRuntime from '$lib/manabi/runtime.svelte';\n  import DictionaryPanel from '$lib/dictionary/dictionary-panel.svelte';")
edit('apps/web/src/routes/+layout.svelte','<ManabiRuntime />','<ManabiRuntime />\n<DictionaryPanel />')
edit('apps/web/svelte.config.js',"'script-src': ['self']","'script-src': ['self', 'wasm-unsafe-eval']")
edit('apps/web/src/lib/service-worker/reader-service-worker.mjs','    if (inScope(url)) {','''    if (inScope(url)) {
      // Only a complete, verified and immutable runtime uses this exact cache.
      const runtimeMatch = /^(vendor\\/manabitan\\/[a-f0-9]{40}\\/)/.exec(url.pathname.slice(scope.pathname.length));
      if (runtimeMatch && !url.search) {
        const root = new URL(runtimeMatch[1], scope);
        event.respondWith((async () => {
          try {
            const cache = await storage.open(`manabi-reader-runtime:${root.href}`);
            if (await cache.match(new URL('.complete.json', root))) {
              const cached = await cache.match(event.request);
              if (cached) return cached;
            }
          } catch { /* A missing/evicted cache is not a persisted dictionary. */ }
          return worker.fetch(event.request);
        })());
        return;
      }''')
p=Path('.gitignore');p.write_text(p.read_text()+'\n.cache/\napps/web/static/vendor/manabitan/\napps/web/static/dictionary-archives/\n')
p=Path('apps/web/package.json');v=json.loads(p.read_text());v['scripts']['build']='node ../../scripts/prepare-dictionaries.mjs && vite build';del v['dependencies']['ua-parser-js'];del v['devDependencies']['@types/ua-parser-js'];p.write_text(json.dumps(v,indent=2)+'\n')
p=Path('pnpm-lock.yaml');s=p.read_text();s,n=re.subn(r"^      (?:'@types/ua-parser-js'|ua-parser-js):\n        specifier: [^\n]+\n        version: [^\n]+\n",'',s,flags=re.M);assert n==2;p.write_text(s)
p=Path('package.json');v=json.loads(p.read_text());v['license']='GPL-3.0-or-later';p.write_text(json.dumps(v,indent=2)+'\n')
Path('LICENSE-ManabiTan-GPL-3.0.txt').write_text(Path('extension-source/LICENSE').read_text())
Path('apps/web/src/lib/functions/file-loaders/utils/init-zip-settings.ts').write_text('''/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { configure as zipConfigure } from '@zip.js/zip.js';

/** Preserve the conservative Android Chromium workaround without a UA-parser dependency. */
export function supportsArchiveWorkers(workerAvailable: boolean, userAgent: string): boolean {
  if (!workerAvailable) return false;
  return !(/Android/i.test(userAgent) && /Chrome\\//i.test(userAgent));
}
export default function initZipSettings() {
  zipConfigure({useWebWorkers: typeof window !== 'undefined' &&
    supportsArchiveWorkers(typeof Worker === 'function', window.navigator.userAgent)});
}
''')
edit('test/reader/run.mjs','  const archive =',"  const provider = join(temp, 'provider-controller.test.mjs');\n  await build({entryPoints: [fileURLToPath(new URL('./provider-controller.test.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', outfile: provider});\n  const archive =")
edit('test/reader/run.mjs','      archive,','      provider,\n      archive,')
p=Path('test/reader/e2e/run.mjs');s=p.read_text()
s=s.replace("import {runBackupAcceptance}","import {runEmbeddedAcceptance} from './embedded-acceptance.mjs';\nimport {runBackupAcceptance}")
s=s.replace("embeddedRuntime: {status: 'blocked', reason: 'Reader has no embedded ManabiTan web runtime/provider UI yet. Extension E2E does not satisfy this gate.'}","embeddedRuntime: {status: results.some(r => r.name.startsWith('embedded:') && r.status === 'failed') ? 'failed' : results.some(r => r.name.startsWith('embedded:')) ? 'tested' : 'not-run'}")
old="    context = await launch('extension', true); page = context.pages()[0] || await context.newPage();\n"
assert s.count(old)==1
s=s.replace(old,old+'''
    await page.goto(origin + '/manage');
    await page.getByRole('button', {name: 'Dictionary settings', exact: true}).click();
    await page.getByLabel('Lookup provider').selectOption('extension');
    await expect(page.locator('[data-dictionary-settings]')).toHaveAttribute('data-provider-state', 'active');
    await page.getByRole('button', {name: 'Close dictionary settings'}).click();
''')
marker="    await check('browser: no uncaught application page exceptions'";assert s.count(marker)==1
s=s.replace(marker,'''
    await close('extension-last-session');
    context = await launch('embedded'); page = context.pages()[0] || await context.newPage();
    await runEmbeddedAcceptance({getPage: () => page, getContext: () => context,
      restart: async () => { await close('embedded-first-session'); context = await launch('embedded'); page = context.pages()[0] || await context.newPage(); },
      origin, fixtures, output, check, importBook, openBook, controlSW, requests: serverRequests});
'''+marker)
s=s.replace("const milliseconds = name.startsWith('manabitan: install') ? 660000 : 90000;", "const milliseconds = name.includes('full official JMdict') || name.includes('default Jitendex') || name.startsWith('manabitan: install') ? 960000 : 150000;")
p.write_text(s)
