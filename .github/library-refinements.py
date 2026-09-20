from pathlib import Path

def edit(path, old, new):
    p = Path(path)
    source = p.read_text()
    assert source.count(old) == 1, (path, old[:100], source.count(old))
    p.write_text(source.replace(old, new))

edit('apps/web/src/lib/library/book-cover.svelte', '  .right-bound .binding {', '  .cover-stage[data-direction="unknown"] .binding {\n    display: none;\n  }\n  .right-bound .binding {')
edit('apps/web/src/lib/library/cover-stack.svelte', '$: visible = books.slice(0, hero ? 5 : 2);', '$: visible = Array.from(new Map(books.map((book) => [book.key, book])).values()).slice(0, hero ? 5 : 2);')
edit('apps/web/src/lib/library/cover-stack.svelte', '{#each visible as book, index (index)}', '{#each visible as book, index (book.key)}')
p = Path('tests/browser/test_books_library.py')
s = p.read_text().replace('import os\n', 'import os\nimport re\n')
s = s.replace(".to_have_class('shelf-item series-item')", ".to_have_class(re.compile(r'\\bseries-item\\b'))")
p.write_text(s)

p = 'apps/web/src/lib/manabi/books.ts'
edit(p, '''  const link = await db.get('books', id);
  if (!link) throw new IntegrationError('not_found');
  ensureOwner(link);
  link.syncEnabled = enabled;
  await db.put('books', link);''', '''  // Read and patch in one transaction so a concurrent folder move cannot be undone.
  const tx = db.transaction('books', 'readwrite');
  const link = await tx.store.get(id);
  if (!link) throw new IntegrationError('not_found');
  ensureOwner(link);
  await tx.store.put({ ...link, syncEnabled: enabled });
  await tx.done;''')
edit(p, '''      const current = await integration.get('books', id);
      if (current) await integration.put('books', { ...current, base: merged });''', '''      // A move may have updated fileId while remote I/O was pending. Patch only
      // the accepted baseline in a single read/write transaction, never a stale locator.
      const tx = integration.transaction('books', 'readwrite');
      const current = await tx.store.get(id);
      if (current?.syncEnabled) await tx.store.put({ ...current, base: merged });
      await tx.done;''')
p = 'apps/web/src/lib/library/local-series.ts'
edit(p, "const journalKey = (sourceId: string) => `library-file-operation:${sourceId}`;", """const journalKey = (sourceId: string) => `library-file-operation:${sourceId}`;
// Share the import admission lock: a read/import of the old path cannot publish
// its locator after the file was moved. Browser Web Locks also cover other tabs.
const fileChange = <T>(library: LocalLibrary, work: () => Promise<T>) =>
  exclusive('import-library-book', () => exclusive(`library-files:${library.id}`, work));""")
s = Path(p).read_text().replace('return exclusive(`library-files:${library.id}`, async () => {', 'return fileChange(library, async () => {')
Path(p).write_text(s)
p = 'apps/web/src/lib/library/library-workspace.svelte'
edit(p, '''    if (refresh) previewFailures = 0;
    const run = ++generation;''', '''    if (refresh) previewFailures = 0;
    previewQueue?.stop();
    previewQueue = new PreviewQueue(() => {
      if (alive) previewFailures++;
    });
    const run = ++generation;''')
edit(p, '''      pending = await pendingMoves();
      await refreshLinkedBooks();
      for (const source of nextSources) {''', '''      const nextPending = await pendingMoves();
      await refreshLinkedBooks();
      if (!alive || run !== generation || owner !== currentUser()?.id) return;
      pending = nextPending;
      for (const source of nextSources) {''')
p = 'apps/web/src/lib/library/view-model.ts'
edit(p, '''  const result: ShelfNode[] = [];
  const decorate = (''', '''  const result: ShelfNode[] = [];
  const revisions = new Map(catalogs.map((catalog) => [sourceKey(catalog.source), catalog.scannedAt]));
  const decorate = (''')
edit(p, '''    const preview = source && file ? previews[sourceBookKey(source, file.id)] : undefined;''', '''    const cachedPreview = source && file ? previews[sourceBookKey(source, file.id)] : undefined;
    const preview = source && cachedPreview?.scannedAt === revisions.get(sourceKey(source))
      ? cachedPreview : undefined;''')
