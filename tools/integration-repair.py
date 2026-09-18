"""One-time asserted repairs; remove after reviewing and committing generated blobs."""
from pathlib import Path
import json

changed = set()
def edit(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    assert text.count(old) == count, (path, old, text.count(old))
    p.write_text(text.replace(old, new))
    changed.add(path)

root = 'apps/web/src/'
for mode in ('paginated', 'continuous'):
    path = root + f'lib/components/book-reader/book-reader-{mode}/book-reader-{mode}.svelte'
    edit(path, '<script lang="ts">', '<script lang="ts">\n  import { resolveReaderFontFamily } from "$lib/manabi/reader-fonts";')
    edit(path, 'style:--font-family-serif={fontFamilyGroupOne}', 'style:--font-family-serif={resolveReaderFontFamily(fontFamilyGroupOne, verticalMode)}')
    edit(path, "${fontFamilyGroupOne || 'Noto Serif JP'}", '${resolveReaderFontFamily(fontFamilyGroupOne, verticalMode)}')
    if mode == 'paginated':
        edit(path, "direction: 'top' | 'right' | 'left' | 'bottom'", "direction: 'top' | 'right' | 'left' | 'bottom' | null")
p = root + 'lib/data/fonts.ts'
edit(p, 'export enum LocalFont {', "export enum LocalFont {\n  AUTOMATIC = 'Manabi Automatic',")
edit(p, 'export const reservedFontNames = new Set([', "export const reservedFontNames = new Set([\n  'Manabi Automatic',")
edit(root + 'lib/data/store.ts', "'fontFamilyGroupOne',\n  'Noto Serif JP'", "'fontFamilyGroupOne',\n  'Manabi Automatic'")
edit(root + 'lib/components/settings/settings-content.svelte', '            LocalFont.NOTOSERIFJP,', '            LocalFont.AUTOMATIC,\n            LocalFont.NOTOSERIFJP,')
p = root + 'lib/functions/file-loaders/epub/generate-epub-html.ts'
edit(p, "import path from 'path-browserify';", "import path from 'path-browserify';\nimport { sanitizeBookHtml } from '$lib/manabi/sanitize-book';")
edit(p, 'childBodyDiv.innerHTML = innerHtml;', 'childBodyDiv.innerHTML = sanitizeBookHtml(innerHtml);')
p = root + 'lib/functions/file-loaders/htmlz/generate-htmlz-html.ts'
edit(p, "import type { HtmlzContent } from './types';", "import type { HtmlzContent } from './types';\nimport { sanitizeBookHtml } from '$lib/manabi/sanitize-book';")
edit(p, 'result.innerHTML = html;', 'result.innerHTML = sanitizeBookHtml(html);')
p = root + 'lib/manabi/client.ts'
edit(p, 'function invalidateAccount() {\n  generation += 1;', 'function invalidateAccount() {\n  refreshSerial += 1;\n  generation += 1;')
edit(p, '    return bytes as T;', "    if (scope.generation !== generation || currentUser()?.id !== scope.userId) throw new IntegrationError('account_changed', 409);\n    return bytes as T;")
edit(p, '  return (await jsonResponse(response)) as T;', "  const value = (await jsonResponse(response)) as T;\n  if (scope.generation !== generation || currentUser()?.id !== scope.userId) throw new IntegrationError('account_changed', 409);\n  return value;")
p = root + 'lib/manabi/preferences.ts'
edit(p, 'let retryAt = 0;', 'let retryAt = 0;\nlet activation = 0;')
edit(p, "  await exclusive(`preferences/${user}`, async () => {\n    unchangedUser(user);\n    const state = active!;", "  const state = active;\n  const admitted = activation;\n  const isCurrent = () => active === state && activation === admitted && state.enabled && currentUser()?.id === user;\n  await exclusive(`preferences/${user}`, async () => {\n    if (!isCurrent()) return;\n    unchangedUser(user);")
edit(p, '      unchangedUser(user);', '      if (!isCurrent()) return;\n      unchangedUser(user);', 3)
edit(p, '      if (currentUser()?.id !== user) return;', '      if (!isCurrent()) return;')
edit(p, '  active.enabled = enabled;\n  if (enabled && !active.initialized) active.local = capture();', '  activation += 1;\n  active = { ...active, enabled };\n  if (enabled) active.local = { ...active.local, ...capture() };')
edit(p, '  await persist(user, active);', "  const state = active;\n  await persist(user, state);\n  if (active !== state || currentUser()?.id !== user) return;")
edit(p, '  if (enabled) await syncPreferences(choice);', '  if (enabled) await syncPreferences(state.initialized ? undefined : choice);')
edit(p, '    activeUser = user;\n    active = null;', '    activation += 1;\n    activeUser = user;\n    active = null;')
edit(p, '    stopped = true;\n    clearInterval(timer);', '    stopped = true;\n    activation += 1;\n    clearInterval(timer);')
edit(p, "      get(account).status === 'available' &&", "      get(preferenceStatus).state !== 'conflict' &&\n      get(account).status === 'available' &&")
p = root + 'lib/manabi/sources.ts'
edit(p, '  revision: string;\n', '  revision: string;\n  headIds?: string[];\n')
edit(p, '    if (!heads.length) return { value: null, revision };', '    const headIds = heads.map((head) => head.id);\n    if (!heads.length) return { value: null, revision, headIds };')
edit(p, 'return { value: heads[0].value, revision };', 'return { value: heads[0].value, revision, headIds };')
edit(p, '      const documents = await this.revisions(key);\n      const superseded = new Set(documents.flatMap((doc) => doc.parents));\n      const parents = documents.filter((doc) => !superseded.has(doc.id)).map((doc) => doc.id);', '      const parents = current.headIds;\n      if (!parents) throw new IntegrationError("invalid_response");')
edit(p, '      value: null,\n      revision,\n      branches:', '      value: null,\n      revision,\n      headIds,\n      branches:')
# These regular expressions intentionally validate hostile control characters.
edit(p, '    parts.some(', '    // eslint-disable-next-line no-control-regex\n    parts.some(')
p = root + 'lib/manabi/books.ts'
edit(p, '      let accepted: StateCopy = remote;', "      const stillEnabled = async () => (await integration.get('books', id))?.syncEnabled === true;\n      if (!(await stillEnabled())) return;\n      let accepted: StateCopy = remote;")
edit(p, '      const clean = await applyAcknowledged(link, captured, merged);', '      if (!(await stillEnabled())) return;\n      ensureOwner(link);\n      const clean = await applyAcknowledged(link, captured, merged);')
p = root + 'service-worker.ts'
edit(p, 'const assets = ', 'const allAssets = ')
edit(p, 'const assetPaths = new Set(assets);', "const assetPaths = new Set(allAssets);\nconst fontAsset = (path: string) => /\\.(?:woff2?|ttf|otf)$/i.test(path);\nconst assets = allAssets.filter((path) => !fontAsset(path) || /KleeOne-Regular\\.[^/]+\\.woff2$/.test(path));")
edit(p, '      await worker.skipWaiting();', '      // Updates activate after existing clients release the old worker.')
edit(p, '  if (assetPaths.has(url.pathname)) {', "  if (fontAsset(url.pathname) && assetPaths.has(url.pathname)) {\n    event.respondWith((async () => {\n      const cache = await caches.open(cacheName);\n      const saved = await cache.match(url.pathname);\n      if (saved) return saved;\n      const response = await fetch(request);\n      if (response.ok && response.type === 'basic') await cache.put(url.pathname, response.clone());\n      return response;\n    })());\n    return;\n  }\n  if (assetPaths.has(url.pathname)) {")
p = root + 'lib/manabi/sanitize-book.ts'
edit(p, 'function allowedImage(value: string) {', "function allowedImage(value: string) {\n  if (value.startsWith('data:image/gif;ttu:') && value.endsWith(';base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')) return true;\n  if (value.startsWith('ttu:') && value.length <= 4096) return true;")
edit(p, "    ADD_URI_SAFE_ATTR: ['src', 'href', 'xlink:href'],", r"    ALLOWED_URI_REGEXP: /^(?:#[\s\S]*|blob:https?:\/\/[\s\S]*|data:image\/(?:png|jpeg|gif|bmp|webp|avif);[\s\S]*|ttu:[\s\S]*|[^:]+)$/i,")
edit(p, "      'srcdoc',", "      'background',\n      'poster',\n      'srcdoc',")
edit(p, "      const fragment = value.startsWith('#') && !/[\\x00-\\x20\\x7f]/.test(value);", "      // eslint-disable-next-line no-control-regex\n      const fragment = ['a', 'use'].includes(tag) && value.startsWith('#') && !/[\\x00-\\x20\\x7f]/.test(value);")
edit(p, '  return value.length <= 4096 &&', '  // eslint-disable-next-line no-control-regex\n  return value.length <= 4096 &&')
p = root + 'routes/connections/+page.svelte'
edit(p, 'request<{ provider_revocation_confirmed: boolean }>', 'request<{ provider_revocation_confirmed: boolean; provider_revocation_supported?: boolean }>')
edit(p, 'message = result.provider_revocation_confirmed', "message = result.provider_revocation_supported === false\n      ? 'Disconnected locally. Remove Manabi access in the provider account settings to revoke its authorization.'\n      : result.provider_revocation_confirmed")
manifest = Path('apps/web/static/manifest.webmanifest')
value = json.loads(manifest.read_text())
value['name'] = 'Manabi Reader'
value['short_name'] = 'Manabi Reader'
manifest.write_text(json.dumps(value, indent=2) + '\n')
changed.add(str(manifest))
Path('review').mkdir(exist_ok=True)
Path('review/changed-paths.json').write_text(json.dumps(sorted(changed)))
