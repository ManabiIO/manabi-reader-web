/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { EpubPublicationDescriptor } from '$lib/functions/file-loaders/epub/epub-publication';

export type PaginatedEngine = 'legacy' | 'foliate-inline';

export function paginatedEngineFor(
  epubPublication: EpubPublicationDescriptor | undefined
): PaginatedEngine {
  return epubPublication?.engine === 'foliate-epub-v1' ? 'foliate-inline' : 'legacy';
}
