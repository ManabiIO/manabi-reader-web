"""Compose exact prior qualified runtime on the concurrent account source.
This research helper is not a runtime dependency or a published product file.
"""
from pathlib import Path
import hashlib, json, shutil, subprocess, tarfile

base='f18c41b2c4674fd67600c41a6ea1b86f165e8b7f'
root=Path.cwd(); evidence=root/'evidence'; evidence.mkdir(exist_ok=True)
prior=root/'prior-input'
patch=(prior/'reader-composed-runtime.patch').read_bytes()
assert hashlib.sha256(patch).hexdigest()=='ea8555bf87756c4975c3e6faf90a69f7c8ceb3115c9d07c51eea0f065fac51ed'
tests=(prior/'test-sources.tar.gz').read_bytes()
assert hashlib.sha256(tests).hexdigest()=='5f2d4357f5d5c2ca937477e1d9c3607faa51096d869aaf1d450d9686539c297a'
subprocess.run(['git','worktree','add','--detach','/tmp/reader-qualified-prior','301aef4957c3cb22162276b11f4a47b35533faae'],check=True)
subprocess.run(['git','-C','/tmp/reader-qualified-prior','apply',str(prior/'reader-composed-runtime.patch')],check=True)
previous=Path('/tmp/reader-qualified-prior')
paths=[line.split(' b/',1)[1] for line in patch.decode().splitlines() if line.startswith('diff --git ')]
retain={'package.json','apps/web/package.json','pnpm-lock.yaml','apps/web/src/lib/data/env.ts'}
for name in paths:
    if name in retain: continue
    source=previous/name; target=root/name
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,target)
# Root source shares the origin/base and retains optional Manabi account behavior.
p=root/'apps/web/src/routes/+layout.svelte';s=p.read_text()
s=s.replace("  import { page } from '$app/stores';", "  import { page } from '$app/stores';\n  import { base } from '$app/paths';\n  import { onDestroy } from 'svelte';\n  import ManabiRuntime from '$lib/manabi/runtime.svelte';")
s=s.replace('<slot />','<ManabiRuntime />\n<slot />').replace('`${basePath}/icons/','`${basePath}${base}/icons/')
s=s.replace('  dialogManager.dialogs$.subscribe((d) => {','  const dialogsSubscription = dialogManager.dialogs$.subscribe((d) => {')
s=s.replace('  page.subscribe((p) => (path = p.url.pathname));','  const stopPage = page.subscribe((p) => (path = p.url.pathname));\n  onDestroy(() => { dialogsSubscription.unsubscribe(); stopPage(); });')
s=s.replace('styleElement.replaceChild(textNode, styleElement.childNodes[0]);','styleElement.replaceChildren(textNode);')
p.write_text(s)
(root/'apps/web/src/lib/manabi/sanitize-book.ts').unlink()
# Restore must use the same validated font contract; root legacy cache URLs
# remain valid for users whose existing settings predate subpath deployment.
p=root/'apps/web/src/lib/service-worker/reader-service-worker.mjs';s=p.read_text()
needle='    if (inScope(url)) {'
if needle in s:
    s=s.replace(needle,"    if (url.origin === scope.origin && url.pathname.startsWith('/userfonts/')) {\n      event.respondWith(storage.open(config.userFontsCacheName).then(async (cache) =>\n        (await cache.match(url.pathname)) ?? new Response(null, {status: 404})));\n      return;\n    }\n"+needle,1)
p.write_text(s)
# Keep existing font keys and books. This is visual branding, not data migration.
p=root/'package.json';v=json.loads(p.read_text());v['name']='manabi-reader-web';v['engines']={'node':'>=24.21.0 <25','pnpm':'12.3.4'};p.write_text(json.dumps(v,indent=2)+'\n')
(root/'.node-version').write_text('24.21.0\n')
# The old fork must not deploy using upstream-specific credentials or triggers.
deploy=root/'.github/workflows/deploy.yml'
if deploy.exists():
    target=root/'.github/quarantined-upstream-deploy.yml.txt';target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(deploy,target);deploy.unlink()
with tarfile.open(prior/'test-sources.tar.gz') as archive:
    for name in ('run.mjs','font-acceptance.mjs','make-fixtures.py'):
        raw=archive.extractfile('test/reader-web/'+name).read()
        target=root/'test/reader/e2e'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
# Source manifest before the deliberate, separately reviewed framework upgrade.
def snapshot(name):
    subprocess.run(['git','add','-N','--','apps/web','test/reader','.github/quarantined-upstream-deploy.yml.txt','.node-version'],check=True)
    changed=subprocess.check_output(['git','diff','--name-only',base],text=True).splitlines()
    changed=[p for p in changed if not p.startswith('research/') and p!='.github/workflows/reader-foundations-research.yml']
    entries=[{'path':p,'content':Path(p).read_text() if Path(p).is_file() else None} for p in changed]
    (evidence/(name+'.json')).write_text(json.dumps(entries))
snapshot('foundations-source')
# Reconcile the framework/compiler/plugin as one peer-compatible group.
for filename in ('package.json','apps/web/package.json'):
    p=root/filename;v=json.loads(p.read_text());v['devDependencies']['svelte']='5.57.0'
    if filename=='package.json':
        v['devDependencies']['prettier-plugin-svelte']='4.1.1';v['devDependencies']['esbuild']='0.28.2';v['devDependencies']['@playwright/test']='1.63.0'
    else:
        v['devDependencies']['@sveltejs/vite-plugin-svelte']='7.3.0';v['devDependencies']['vite']='8.3.0'
    p.write_text(json.dumps(v,indent=2)+'\n')
p=root/'apps/web/vite.config.js'
p.write_text("import { sveltekit } from '@sveltejs/kit/vite';\n\n/** @type {import('vite').UserConfig} */\nexport default {\n  plugins: [sveltekit()],\n  ssr: { noExternal: ['@fortawesome/*', '@popperjs/*'] }\n};\n")
p=root/'apps/web/src/manabi-browser-types.d.ts'
p.write_text('/// <reference types="wicg-file-system-access" />\n/// <reference types="webappsec-credential-management" />\n')
# The gesture package already declares the complete swipe event, including null
# when no direction is recognized. Do not narrow that shared declaration.
(evidence/'base.txt').write_text(base+'\n')
