"""Qualification composition only; publish the resulting source, not this helper."""
from pathlib import Path
import re

def edit(name, fn):
    p=Path(name);p.write_text(fn(p.read_text()))

def limited(s):
    s=s.replace('export interface ArchiveOptions {', '''/** One cumulative decoder budget can span an outer backup and its nested books. */
export class ArchiveBudget {
  private decoded = 0;
  constructor(readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error('Invalid shared archive budget');
  }
  claim(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.decoded + bytes > this.maximum)
      throw new ArchiveLimitError('Decoded backup data exceeds the shared size limit');
    this.decoded += bytes;
  }
}

export const BACKUP_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  ...BOOK_ARCHIVE_LIMITS,
  compressedBytes: 1024 * 1024 * 1024,
  entryBytes: BOOK_ARCHIVE_LIMITS.compressedBytes,
  totalBytes: 1024 * 1024 * 1024,
  entryCount: 32768
});

export interface ArchiveOptions {''')
    s=s.replace('  signal?: AbortSignal;', '''  signal?: AbortSignal;
  budget?: ArchiveBudget;
  /** Backup names are literal ZIP keys: upstream encodes title punctuation with %. */
  literalNames?: boolean;''',1)
    s=s.replace('export function validateArchivePath(name: string, directory = false): string {','export function validateArchivePath(name: string, directory = false, literalNames = false): string {')
    s=s.replace('/%(?:2e|2f|5c|00)/i.test(name) ||','(!literalNames && /%(?:2e|2f|5c|00)/i.test(name)) ||')
    s=s.replace('validateArchivePath(entry.filename, entry.directory)','validateArchivePath(entry.filename, entry.directory, options.literalNames)')
    s=s.replace('    this.controller.signal.throwIfAborted();\n    const entry = this.entries.get(name);', '''    this.controller.signal.throwIfAborted();
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error('Invalid archive read limit');
    const entry = this.entries.get(name);''')
    s=s.replace('      this.decoded += bytes;','      this.options.budget?.claim(bytes);\n      this.decoded += bytes;')
    return s
edit('apps/web/src/lib/functions/file-loaders/utils/limited-archive.ts',limited)

def base(s):
    s=s.replace('  TextWriter,\n','').replace('  ZipReader,\n','').replace('  ZipWriter,\n  type Entry','  ZipWriter')
    s="import { readRestoredBook } from '$lib/functions/file-loaders/utils/restored-book';\nimport type { ArchiveBudget } from '$lib/functions/file-loaders/utils/limited-archive';\n"+s
    at=s.index('export abstract class BaseStorageHandler')
    at=s.index('{',at)+1
    s=s[:at]+'\n  protected restoreBudget: ArchiveBudget | undefined;\n'+s[at:]
    start=s.index('  protected async readFromZip(');end=s.index('  protected setRootFile(',start)
    s=s[:start]+'''  protected async extractBookData(book: Blob, filename: string, progressBase = 0.9) {
    const data = await readRestoredBook(book, BaseStorageHandler.getImageMimeTypeFromExtension, {
      signal: this.cancelSignal,
      budget: this.restoreBudget
    });
    BaseStorageHandler.reportProgress(progressBase);
    if (!data) return undefined;
    const { characters, lastBookModified, lastBookOpen } = BaseStorageHandler.getBookMetadata(filename);
    return {
      ...data,
      hasThumb: true,
      characters: BaseStorageHandler.getBookCharacters(characters || 0, data.sections),
      lastBookModified,
      lastBookOpen
    };
  }

'''+s[end:]
    return s
edit('apps/web/src/lib/data/storage/handler/base-handler.ts',base)

def backup(s):
    s=s.replace("import { BlobReader, BlobWriter, ZipReader, type Entry, type ZipWriter } from '@zip.js/zip.js';", "import type { Entry, ZipWriter } from '@zip.js/zip.js';\nimport { LimitedArchive, ArchiveBudget, BACKUP_ARCHIVE_LIMITS } from '$lib/functions/file-loaders/utils/limited-archive';\nimport { logger } from '$lib/data/logger';")
    s=s.replace('  private importReader: ZipReader<Blob> | undefined;', '  private importArchive: LimitedArchive | undefined;\n\n  private importOpening = false;')
    s=s.replace('      this.importReader = undefined;', '      void this.closeBackupZip().catch((error) => logger.error(error));')
    start=s.index('  async setBackupZip(');end=s.index('  async getFilenameForRecentCheck',start)
    s=s[:start]+'''  async closeBackupZip(): Promise<void> {
    const archive = this.importArchive;
    this.importArchive = undefined;
    this.importEntries = [];
    this.rootFiles.clear();
    this.restoreBudget = undefined;
    await archive?.close();
  }

  async setBackupZip(data: Blob, signal?: AbortSignal) {
    if (this.importOpening || this.importArchive)
      throw new Error('A backup import is already active');
    this.importOpening = true;
    const budget = new ArchiveBudget(BACKUP_ARCHIVE_LIMITS.totalBytes);
    let archive: LimitedArchive | undefined;
    try {
      archive = await LimitedArchive.open(data, {
        signal, budget, limits: BACKUP_ARCHIVE_LIMITS, literalNames: true
      });
      const entries = [...archive.entries.values()].filter((entry) => !entry.directory);
      const titles = new Map<string, ReplicationContext>();
      for (const entry of entries) {
        signal?.throwIfAborted();
        const nameParts = entry.filename.split('/');
        const sanitizedTitle = nameParts[0];
        const title = BaseStorageHandler.desanitizeFilename(sanitizedTitle);
        if (nameParts.length === 1) {
          // Preserve the actual ZIP key, not a decoded filename used as a path.
          this.setRootFile(title, { id: entry.filename, name: entry.filename });
        } else {
          const context = titles.get(title) || { title, imagePath: '' };
          titles.set(title, context);
        }
      }
      this.importArchive = archive;
      this.importEntries = entries;
      this.restoreBudget = budget;
      return [...titles.values()];
    } catch (error) {
      await archive?.close();
      this.rootFiles.clear();
      throw error;
    } finally {
      this.importOpening = false;
    }
  }

  private async readBackupBlob(entry: Entry, progressBase = 0.9): Promise<Blob> {
    if (!this.importArchive) throw new Error('No backup import is active');
    const blob = await this.importArchive.readBlob(entry.filename);
    BaseStorageHandler.reportProgress(progressBase);
    return blob;
  }

  private async extractAsJSON(entry: Entry, _errorMessage: string, progressBase = 0.9) {
    if (!this.importArchive) throw new Error('No backup import is active');
    const text = await this.importArchive.readText(entry.filename);
    BaseStorageHandler.reportProgress(progressBase);
    return JSON.parse(text);
  }

'''+s[end:]
    s,count=re.subn(r"this\.readFromZip\(\s*new BlobWriter\(\),\s*'[^']+',\s*zipEntry,\s*([\s\S]*?)\n    \)",r'this.readBackupBlob(zipEntry, \1)',s)
    assert count==5,count
    return s
edit('apps/web/src/lib/data/storage/handler/backup-handler.ts',backup)

def replication(s):
    s=s.replace("import pLimit from 'p-limit';\n",'')
    start=s.index('  const contexts = await source.setBackupZip(file);')
    end=s.index('\n}',start)
    old=s[start:end]
    old=old.replace('source.setBackupZip(file)','source.setBackupZip(file, cancelSignal)')
    s=s[:start]+'  try {\n'+old+'\n  } finally {\n    await source.closeBackupZip();\n  }'+s[end:]
    s=s.replace('  const replicationLimiter = pLimit(1);\n','').replace('  const replicationTasks: Promise<void>[] = [];','  const replicationTasks: Array<() => Promise<void>> = [];')
    s=s.replace('      replicationLimiter(async () => {','      async () => {').replace('      })\n    )\n  );','      }\n    )\n  );').replace('      })\n    );','      }\n    );').replace('[replicationLimiter],','undefined,')
    s=s.replace('  await Promise.all(replicationTasks);', '''  // Do not clear an eager promise queue: queued promises would never settle.
  // Stop admitting new tasks and drain the active operation before cleanup.
  for (const task of replicationTasks) {
    if (cancelSignal?.aborted) break;
    try {
      await task();
    } catch (error) {
      if (cancelSignal?.aborted) break;
      throw error;
    }
  }''')
    return s
edit('apps/web/src/lib/functions/replication/replicator.ts',replication)

def reader(s):
    s=s.replace('    debounceTime,','    debounceTime,\n    distinctUntilChanged,',1)
    s=s.replace("    map((pageObj) => Number(pageObj.url.searchParams.get('id'))),", "    map((pageObj) => Number(pageObj.url.searchParams.get('id'))),\n    distinctUntilChanged(),")
    start=s.index('  const initBookmarkData$ =');end=s.index('  const bookData$ =',start);s=s[:start]+s[end:]
    s=s.replace('      sectionList$.next(rawBookData.sections || []);', '''      // Initialize from this book before publishing renderable HTML. A hidden
      // template subscription to the non-replayed raw stream can miss its only
      // emission when Svelte mounts the conditional Reader subtree lazily.
      bookmarkData = database.getBookmark(rawBookData.id);
      sectionList$.next(rawBookData.sections || []);''')
    return s.replace("  {$initBookmarkData$ ?? ''}\n",'')
edit('apps/web/src/routes/b/+page.svelte',reader)
edit('apps/web/src/lib/components/html-renderer.svelte',lambda s:s.replace('  afterUpdate(() => {', '''  let displayedHtml: string | undefined;
  afterUpdate(() => {
    // Binding updates and font reflows are not new content loads. Re-emitting
    // here destroys the Reader's geometry/position owner for unchanged HTML.
    if (html === displayedHtml) return;
    displayedHtml = html;''')))
edit('test/reader/run.mjs',lambda s:s.replace("  const localMedia =", '''  const restored = join(temp, 'restored-book.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./restored-book.test.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', outfile: restored
  });
  const localMedia =''').replace('      archive,','      archive,\n      restored,'))
