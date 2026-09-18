"""Temporary deterministic migration of reviewed edits; removed after blob review."""
from pathlib import Path
import json


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    if old not in text and new in text:
        return
    assert text.count(old) == count, (path, old)
    p.write_text(text.replace(old, new))


p = Path('package.json')
value = json.loads(p.read_text())
value['devDependencies']['svelte'] = '4.2.20'
value['devDependencies']['prettier-plugin-svelte'] = '3.4.0'
value.pop('pnpm', None)  # Build allowlist already lives in pnpm-workspace.yaml.
p.write_text(json.dumps(value, indent=2) + '\n')
p = Path('apps/web/tsconfig.json')
value = json.loads(p.read_text())
value['compilerOptions']['allowJs'] = True
value['compilerOptions']['checkJs'] = False
p.write_text(json.dumps(value, indent=2) + '\n')
replace('apps/web/src/lib/manabi/preferences.ts', 'accountSubscription.unsubscribe();', 'accountSubscription();')
replace('apps/web/src/lib/manabi/sources.ts', 'kind: handle.kind', "kind: handle.kind === 'directory' ? 'folder' : 'file'")
replace('apps/web/src/lib/data/storage/storage-source-manager.ts', '      salt,', '      salt: new Uint8Array(salt),')
replace('apps/web/src/lib/data/storage/storage-oauth-manager.ts', 'this.base64Url(arr)', 'this.base64Url(arr.buffer)')
replace('apps/web/src/lib/data/database/books-db/versions/books-db.ts', 'export default BooksDb;', 'export type { BooksDb as default };')
replace('apps/web/src/lib/components/ripple.svelte', 'function animateRipple(node: HTMLElement, params: any)', 'function animateRipple(node: HTMLElement, params: any = {})')
replace('apps/web/src/lib/components/button-toggle-group/button-toggle-group.svelte', ' slot="icon"', '', 2)
for path in ('apps/web/src/lib/manabi/sources.ts', 'apps/web/src/lib/manabi/sanitize-book.ts'):
    p = Path(path)
    text = p.read_text()
    if '/* eslint-disable no-control-regex' not in text:
        p.write_text('/* eslint-disable no-control-regex -- Deliberately reject control characters in untrusted paths. */\n' + text)
# Preserve every built-in theme instead of coercing ecru/gray/black to light.
p = Path('apps/web/src/lib/manabi/preferences.ts')
text = p.read_text()
needle = "bind('reader.fontFamilyGroupTwo'"
if "reader.themeName" not in text:
    at = text.index(needle)
    text = text[:at] + "bind('reader.themeName', 'theme', (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v));\n" + text[at:]
p.write_text(text)
# Readonly APIs also carry the expected account, and success must identify it.
p = Path('apps/web/src/lib/manabi/client.ts')
text = p.read_text().replace('[A-Za-z0-9_/?=&.%:-]*', '[A-Za-z0-9_/?=&.%:+-]*')
text = text.replace('responseUser !== null && responseUser !== scope.userId', 'response.ok && responseUser !== scope.userId')
p.write_text(text)
