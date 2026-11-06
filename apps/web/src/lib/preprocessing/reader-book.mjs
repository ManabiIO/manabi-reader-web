/** @license BSD-3-Clause */
import { BookPreprocessingSession } from './session.mjs';
import { ChapterOpeningController } from './presentation.mjs';
import { MemoryChapterCache } from './cache.mjs';

/** One mounted renderer/book owner. The caller owns its DOM and keeps it masked
 * until commit; analysis, interaction and geometry have separate lifetimes. */
export class ReaderLanguageBook {
  constructor({ runtime, chapters, bookKey, resourceVersion, renderHTML, interaction, report }) {
    this.chapters = chapters;
    this.bookKey = bookKey;
    this.runtime = runtime;
    this.interaction = interaction;
    this.activeSignal = null;
    this.siblings = [];
    this.renderHTML = renderHTML;
    this.pending = null;
    this.disposed = false;
    this.session = new BookPreprocessingSession({
      provider: runtime?.preprocessor,
      bookKey,
      chapters,
      contextKey: 'reader-web-source-v1',
      resourceVersion,
      cache: new MemoryChapterCache(),
      // Only bounded book-lifetime memory. Cross-restart derived caches remain
      // disabled until their resource rebinding is separately qualified.
      report
    });
    this.controller = new ChapterOpeningController({
      session: this.session,
      stage: async (result, { index, signal }) => {
        const request = this.pending;
        if (!request || request.index !== index) throw new DOMException('Superseded', 'AbortError');
        signal.throwIfAborted();
        // React has already installed the unprocessed chapter behind its mask.
        // Only transformed output replaces that DOM. Identity keeps its exact
        // prepared image/spoiler/author markup and does not incur an extra parse.
        if (result.sidecar !== null) request.root.innerHTML = this.renderHTML(result.html, index);
        return {
          root: request.root,
          prepare: () => request.prepare(signal),
          commit: request.commit,
          // React owns the reusable root. A predecessor must never clear a
          // successor's DOM; bindings are disposed independently by the host.
          rollback() {}
        };
      },
      interaction: async (root, { index, result, signal }) => {
        this.activeSignal = signal;
        const attach = runtime?.attachChapter ?? interaction;
        return attach
          ? attach(root, {
              bookKey,
              chapterID: chapters[index].id,
              signal,
              analysis:
                result.sidecar !== null && typeof result.sidecar === 'object'
                  ? result.sidecar
                  : null
            })
          : () => {};
      },
      report,
      isVisible: () => globalThis.document?.visibilityState !== 'hidden'
    });
  }
  get hasAnalysis() {
    return !!this.runtime?.preprocessor;
  }
  /** Continuous reading exposes adjacent source chapters as well. Generic
   * selection stays available there without inventing analyzed sidecars. */
  async attachSiblings(container, activeIndex) {
    const signal = this.activeSignal;
    if (!signal || !this.interaction) return;
    for (let index = 0; index < container.children.length; index++) {
      if (index === activeIndex) continue;
      signal.throwIfAborted();
      const detach = await this.interaction(container.children[index], {
        bookKey: this.bookKey,
        chapterID: this.chapters[index].id,
        signal,
        analysis: null
      });
      if (typeof detach !== 'function')
        throw new Error('Chapter interaction must return a disposer');
      if (signal.aborted) {
        detach();
        signal.throwIfAborted();
      }
      this.siblings.push(detach);
    }
  }
  async open(index, root, { prepare, commit }) {
    if (this.disposed) throw new DOMException('Reader closed', 'AbortError');
    const request = { index, root, prepare, commit };
    this.pending = request;
    try {
      return await this.controller.open(index);
    } catch (error) {
      if (this.pending === request) {
        try {
          this.retire();
        } catch {
          // Keep the original opening failure after retiring all bindings.
        }
      }
      throw error;
    }
  }
  retire() {
    this.pending = null;
    try {
      this.controller.retire();
    } finally {
      this.releaseSiblings();
    }
  }
  releaseSiblings() {
    this.activeSignal = null;
    for (const detach of this.siblings.splice(0)) {
      try {
        detach();
      } catch {
        // One provider disposer must not retain other chapter interactions.
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
    try {
      this.controller.dispose();
    } finally {
      this.releaseSiblings();
    }
  }
}
