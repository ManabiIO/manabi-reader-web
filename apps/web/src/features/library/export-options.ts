/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { StorageDataType } from '../../lib/data/storage/storage-types';

export const bookExportOptions = [
  [StorageDataType.DATA, 'Book data'],
  [StorageDataType.PROGRESS, 'Reading position'],
  [StorageDataType.STATISTICS, 'Statistics'],
  [StorageDataType.AUDIOBOOK, 'Audiobook'],
  [StorageDataType.SUBTITLE, 'Subtitles']
] as const;
export type BookExportPart = (typeof bookExportOptions)[number][0];
export function parseBookExportParts(value: unknown): BookExportPart[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > bookExportOptions.length ||
    new Set(value).size !== value.length ||
    value.some((part) => !bookExportOptions.some(([key]) => key === part))
  )
    throw new Error('Choose the book data to export.');
  return [...value];
}
