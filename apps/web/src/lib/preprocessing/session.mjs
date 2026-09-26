/** @license BSD-3-Clause */
import {
  aborted,
  canonicalJSON,
  chapterCacheKey,
  identifier,
  MAX_CHAPTER_BYTES,
  utf8Size,
  validateProvider,
  normalizeChapterResult,
  identityPreprocessor
} from './contracts.mjs';

export class GenerationChanged extends Error {
  constructor() {
    super('Dictionary or preprocessor generation changed; retry this chapter');
    this.name = 'GenerationChanged';
  }
}
const pause = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

/** One book lifetime; renders are exclusively owned by the latest open(). */
export class BookPreprocessingSession {
  constructor({
    provider = null,
    cache,
    bookKey,
    chapters,
    contextKey,
    resourceVersion,
    analysisOptions = {},
    report = () => {}
  }) {
    this.provider = validateProvider(provider ?? identityPreprocessor);
    this.cache = cache;
    this.bookKey = identifier(bookKey, 'book key');
    this.contextKey = identifier(contextKey, 'analysis context');
    this.resourceVersion = identifier(resourceVersion, 'resource version');
    this.analysisOptions = JSON.parse(canonicalJSON(analysisOptions));
    if (!Array.isArray(chapters)) throw new TypeError('Missing chapters');
    this.chapters = chapters.map((c) => ({
      id: identifier(c.id, 'chapter ID'),
      baseURL: identifier(c.baseURL, 'chapter base URL'),
      html: c.html
    }));
    if (new Set(this.chapters.map((c) => c.id)).size !== this.chapters.length)
      throw new Error('Duplicate chapter identity');
    for (const c of this.chapters)
      if (typeof c.html !== 'string' || utf8Size(c.html) > MAX_CHAPTER_BYTES)
        throw new Error('Chapter exceeds input budget');
    this.report = (event) => {
      try {
        report(event);
      } catch {
        /* diagnostics cannot change correctness */
      }
    };
    this.disposed = false;
    this.revision = 0;
    this.foreground = null;
    this.background = null;
    this.serial = Promise.resolve();
    this.fingerprint = null;
    this.projections = new Map();
    this.lastPresented = null;
  }
  assertLive() {
    if (this.disposed) throw new DOMException('Book closed', 'AbortError');
  }
  async currentFingerprint(signal) {
    aborted(signal);
    this.assertLive();
    const raw = await this.provider.fingerprint({ signal });
    const value = raw === null ? null : identifier(raw, 'engine fingerprint');
    aborted(signal);
    this.assertLive();
    if (this.fingerprint !== value) {
      this.fingerprint = value;
      this.projections.clear();
      this.report({ type: 'generation', fingerprint: value });
    }
    return value;
  }
  // A single processor session, including source-reading memory, owns analysis.
  // Cancellation is cooperative; a non-cooperative worker must enforce its own
  // request deadline and terminate rather than permitting overlapping mutation.
  exclusive(operation, signal) {
    const result = this.serial
      .catch(() => {})
      .then(() => {
        aborted(signal);
        this.assertLive();
        return operation();
      });
    this.serial = result.then(
      () => {},
      () => {}
    );
    return result;
  }
  async prepare(index, signal) {
    const chapter = this.chapters[index];
    if (!chapter) throw new RangeError('Chapter index out of range');
    return this.exclusive(async () => {
      const fingerprint = await this.currentFingerprint(signal);
      const key =
        fingerprint === null
          ? null
          : await chapterCacheKey({
              provider: this.provider,
              fingerprint,
              source: chapter.html,
              bookKey: this.bookKey,
              chapterID: chapter.id,
              baseURL: chapter.baseURL,
              contextKey: this.contextKey,
              resourceVersion: this.resourceVersion,
              analysisOptions: this.analysisOptions
            });
      aborted(signal);
      let cached;
      try {
        if (key !== null) cached = await this.cache?.get(key);
      } catch {
        this.report({ type: 'cache-unavailable' });
      }
      aborted(signal);
      let result = null;
      let cacheHit = false;
      if (cached) {
        try {
          result = normalizeChapterResult(cached, chapter.html, fingerprint);
          if (result.sidecar === null)
            result = null; // Never reuse negative/unprocessed output.
          else cacheHit = true;
        } catch {
          this.report({ type: 'cache-corrupt' });
        }
      }
      if (result === null) {
        this.report({ type: 'processing', index });
        result = normalizeChapterResult(
          await this.provider.preprocess(
            {
              protocol: 1,
              bookKey: this.bookKey,
              chapterID: chapter.id,
              html: chapter.html,
              baseURL: chapter.baseURL,
              contextKey: this.contextKey,
              resourceVersion: this.resourceVersion,
              fingerprint,
              analysisOptions: JSON.parse(canonicalJSON(this.analysisOptions))
            },
            { signal }
          ),
          chapter.html,
          fingerprint
        );
      }
      aborted(signal);
      if ((await this.currentFingerprint(signal)) !== fingerprint) throw new GenerationChanged();
      if (!cacheHit && key !== null && result.sidecar !== null) {
        try {
          await this.cache?.put(key, result);
        } catch {
          this.report({ type: 'cache-write-failed' });
        }
      }
      aborted(signal);
      // Recheck AFTER persistence as well; an IDB write may yield to an update.
      if ((await this.currentFingerprint(signal)) !== fingerprint) throw new GenerationChanged();
      if (fingerprint !== null) this.projections.set(index, result.vocabulary);
      return result;
    }, signal);
  }
  async open(index) {
    this.assertLive();
    const revision = ++this.revision;
    this.foreground?.abort();
    this.background?.abort();
    this.background = null;
    this.lastPresented = null;
    const controller = new AbortController();
    this.foreground = controller;
    const result = await this.prepare(index, controller.signal);
    aborted(controller.signal);
    this.assertLive();
    if (revision !== this.revision) throw new DOMException('Superseded chapter', 'AbortError');
    this.lastPresented = { index, revision };
    // The caller must install/mount result before removing its loading barrier.
    return { result, revision, signal: controller.signal };
  }
  async admitPresentation(revision, result) {
    this.assertLive();
    const signal = this.foreground?.signal;
    aborted(signal);
    if (revision !== this.revision) throw new DOMException('Superseded chapter', 'AbortError');
    if ((await this.currentFingerprint(signal)) !== result.fingerprint)
      throw new GenerationChanged();
    aborted(signal);
    this.assertLive();
    if (revision !== this.revision) throw new DOMException('Superseded chapter', 'AbortError');
  }
  // Deployment/dictionary change notifications invalidate pending work and
  // derived vocabulary, but deliberately leave already visible DOM unchanged.
  invalidate() {
    this.assertLive();
    ++this.revision;
    this.foreground?.abort();
    this.background?.abort();
    this.background = null;
    this.fingerprint = null;
    this.projections.clear();
    this.lastPresented = null;
    this.report({ type: 'invalidated' });
  }
  didPresent(revision, { isVisible = () => true } = {}) {
    this.assertLive();
    if (
      this.fingerprint === null ||
      this.lastPresented?.revision !== revision ||
      this.revision !== revision ||
      this.background
    )
      return;
    const controller = new AbortController();
    this.background = controller;
    const current = this.lastPresented.index;
    const remaining = this.chapters.map((_, i) => i).filter((i) => i !== current);
    remaining.sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
    void (async () => {
      try {
        for (const index of remaining) {
          aborted(controller.signal);
          while (!isVisible()) {
            await new Promise((r) => globalThis.setTimeout(r, 250));
            aborted(controller.signal);
          }
          await pause();
          aborted(controller.signal);
          await this.prepare(index, controller.signal);
          this.report({
            type: 'indexed',
            index,
            processed: this.projections.size,
            total: this.chapters.length
          });
          // No live DOM mutation: background work only fills caches/projections.
        }
      } catch (error) {
        if (!controller.signal.aborted && !this.disposed)
          this.report({ type: 'background-stopped', reason: error.name });
      } finally {
        if (this.background === controller) this.background = null;
      }
    })();
  }
  vocabulary() {
    const words = new Map();
    for (const [chapterIndex, projection] of [...this.projections].sort(([a], [b]) => a - b)) {
      for (const row of projection) {
        const existing = words.get(row.key);
        if (!existing) words.set(row.key, { ...row, chapters: [chapterIndex] });
        else {
          existing.count += row.count;
          if (!Number.isSafeInteger(existing.count))
            throw new Error('Vocabulary occurrence overflow');
          if (!existing.chapters.includes(chapterIndex)) existing.chapters.push(chapterIndex);
        }
      }
    }
    return {
      words: [...words.values()],
      processedChapters: this.projections.size,
      totalChapters: this.chapters.length
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.revision;
    this.foreground?.abort();
    this.background?.abort();
    this.projections.clear();
    // Provider lifetime is deployment-owned, not book-owned. Do not dispose it
    // while another renderer/book session may still hold a reference.
  }
}
