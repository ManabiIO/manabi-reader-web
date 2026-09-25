/** @license BSD-3-Clause */
export type JSONValue = null | boolean | number | string | JSONValue[] | {[key: string]: JSONValue};
export interface VocabularyRow {key: string; term: string; reading: string | null; count: number;}
export interface Chapter {id: string; baseURL: string; html: string;}
export interface ChapterResult {protocol: 1; fingerprint: string | null; html: string; sidecar: JSONValue; vocabulary: VocabularyRow[];}
export type PreparedChapter = ChapterResult;
export interface ChapterInput {protocol: 1; bookKey: string; chapterID: string; html: string; baseURL: string; contextKey: string; resourceVersion: string; fingerprint: string | null; analysisOptions: JSONValue;}
export interface Preprocessor {
  protocol: 1; id: string; release: string;
  fingerprint(options?: {signal?: AbortSignal}): Promise<string | null>;
  preprocess(input: ChapterInput, options?: {signal?: AbortSignal}): Promise<ChapterResult | null>;
  mount(root: HTMLElement, sidecar: JSONValue): (() => void) | Promise<() => void>;
  dispose(): void | Promise<void>;
}
export interface ChapterCache {get(key: string): Promise<unknown>; put(key: string, value: ChapterResult): Promise<void>;}
export interface VocabularySnapshot {words: (VocabularyRow & {chapters: number[]})[]; processedChapters: number; totalChapters: number;}
export interface SessionOptions {provider?: Preprocessor | null; cache?: ChapterCache; bookKey: string; chapters: Chapter[]; contextKey: string; resourceVersion: string; analysisOptions?: JSONValue; report?: (event: Record<string, unknown>) => void;}
