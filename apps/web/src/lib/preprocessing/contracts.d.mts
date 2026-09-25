/** @license BSD-3-Clause */
import type {Preprocessor,ChapterResult,JSONValue} from './index.mjs';
export const PROTOCOL_VERSION: 1;
export const CACHE_SCHEMA: 2;
export const MAX_CHAPTER_BYTES: number;
export const MAX_RESULT_BYTES: number;
export const utf8Size: (value: string) => number;
export function aborted(signal?: AbortSignal): void;
export function canonicalJSON(value: unknown): string;
export function sha256(value: string|BufferSource): Promise<string>;
export function identifier(value: unknown, label: string): string;
export function validateProvider(provider: unknown): Preprocessor;
export function validateResult(result: unknown, fingerprint: string|null): ChapterResult;
export function chapterCacheKey(input: {
 provider: Pick<Preprocessor,'id'|'release'>; fingerprint: string; source: string;
 bookKey: string; chapterID: string; baseURL: string; contextKey: string;
 resourceVersion: string; analysisOptions?: JSONValue;
}): Promise<string>;
export function unchangedChapter(html: string, fingerprint?: string|null): ChapterResult;
export function normalizeChapterResult(output: unknown, html: string, fingerprint: string|null): ChapterResult;
export const identityPreprocessor: Readonly<Preprocessor>;
