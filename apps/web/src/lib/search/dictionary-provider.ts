/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface DictionaryPreview {
  id: string;
  term: string;
  reading: string;
  senses: { source: string; text: string; tags: string[] }[];
}

export interface DictionaryResult {
  version: 1;
  query: string;
  matchedQuery: string;
  /** True when the provider produced prefix-derived results. */
  prefix: boolean;
  dictionaryCount: number;
  preview: { items: DictionaryPreview[]; hasMore: boolean };
  lookup?: object;
}

export interface DictionaryStatus {
  dictionaries: {
    title: string;
    revision?: string;
    author?: string;
    description?: string;
  }[];
  preferences: { disabled: string[] };
}

export interface RecommendedDictionary {
  name: string;
  description: string;
  category: 'terms' | 'kanji' | 'frequency';
  homepage: string;
  downloadUrl: string;
}

export interface DictionaryClient {
  status(options?: { signal?: AbortSignal }): Promise<DictionaryStatus>;
  search(query: string, full: boolean, options: { signal: AbortSignal }): Promise<DictionaryResult>;
  importDictionary(
    blob: Blob,
    options: { signal: AbortSignal; onProgress: (value: unknown) => void }
  ): Promise<{ summary: { title: string }; warnings: string[]; cancelledAfterCommit: boolean }>;
  deleteDictionary(title: string, options?: { signal?: AbortSignal }): Promise<DictionaryStatus>;
  setEnabled(title: string, enabled: boolean): Promise<DictionaryStatus>;
  setDefault(choice: string, title?: string): Promise<DictionaryStatus>;
  close(): Promise<void>;
}

export interface DictionaryRuntime {
  client: DictionaryClient;
  render: (
    container: HTMLElement,
    result: NonNullable<DictionaryResult['lookup']>,
    lookup: (query: string) => void
  ) => () => void;
  installDefault: (options: {
    signal: AbortSignal;
    onProgress: (loaded: number, total: number) => void;
  }) => Promise<Blob>;
  recommendations: (options: { signal: AbortSignal }) => Promise<RecommendedDictionary[]>;
}

export type OpenDictionaryProvider = () => Promise<DictionaryRuntime>;
