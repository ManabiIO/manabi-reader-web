/** @license BSD-3-Clause */
import type { DictionaryRuntime } from '../search/dictionary-provider';
import type { Chapter, ChapterResult } from './index.mjs';
export class ReaderLanguageBook {
  constructor(options: {
    runtime?: DictionaryRuntime;
    chapters: Chapter[];
    bookKey: string;
    resourceVersion: string;
    renderHTML(html: string, index: number): string;
    interaction?: DictionaryRuntime['attachChapter'];
    report?(event: Record<string, unknown>): void;
  });
  readonly chapters: Chapter[];
  readonly bookKey: string;
  readonly hasAnalysis: boolean;
  attachSiblings(container: HTMLElement, activeIndex: number): Promise<void>;
  open(
    index: number,
    root: HTMLElement,
    hooks: {
      prepare(signal: AbortSignal): Promise<void>;
      commit(): void;
    }
  ): Promise<ChapterResult>;
  retire(): void;
  dispose(): void;
}
