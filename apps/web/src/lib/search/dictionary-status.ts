/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface DictionaryCountGroup {
  [key: string]: number;
}

export interface DictionaryStorageStatus {
  usage?: number;
  quota?: number;
  persisted: boolean;
}

const countFormat = new Intl.NumberFormat();

export function dictionaryCountLabel(counts: DictionaryCountGroup | undefined): string {
  if (!counts) return '';
  const parts: string[] = [];
  const append = (key: string, singular: string, plural = singular) => {
    const value = counts[key];
    if (!Number.isSafeInteger(value) || value <= 0) return;
    parts.push(`${countFormat.format(value)} ${value === 1 ? singular : plural}`);
  };
  append('terms', 'term', 'terms');
  append('kanji', 'kanji');
  append('termMeta', 'term metadata');
  append('kanjiMeta', 'kanji metadata');
  append('media', 'media item', 'media items');
  return parts.join(' · ');
}

export function dictionaryStorageLabel(storage: DictionaryStorageStatus | undefined): string {
  if (!storage) return '';
  return storage.persisted
    ? 'Dictionary storage: persistent for this Reader origin.'
    : 'Dictionary storage: browser eviction is possible under storage pressure.';
}
