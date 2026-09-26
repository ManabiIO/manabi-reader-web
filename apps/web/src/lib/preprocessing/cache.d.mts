import type { ChapterCache, ChapterResult } from './index.d.mts';
export class MemoryChapterCache implements ChapterCache {
  constructor(maxBytes?: number);
  get(key: string): Promise<unknown>;
  put(key: string, value: ChapterResult): Promise<void>;
}
export class IndexedDBChapterCache implements ChapterCache {
  constructor(options?: { indexedDB?: IDBFactory; maxBytes?: number; maxEntries?: number });
  get(key: string): Promise<unknown>;
  put(key: string, value: ChapterResult): Promise<void>;
  close(): Promise<void>;
}
