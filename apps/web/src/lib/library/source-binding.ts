/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { SourceDescriptor } from './catalog';
import type { LibrarySource } from '../manabi/sources';

/** A stored locator must never resolve to a reconfigured source's different root. */
export function boundLibrarySource<T extends Pick<LibrarySource, 'id' | 'owner' | 'root'>>(
  descriptor: SourceDescriptor,
  adapter: T
): T {
  if (
    adapter.id !== descriptor.id ||
    adapter.owner !== descriptor.owner ||
    adapter.root !== descriptor.root
  )
    throw new Error(
      'This library source changed. Reopen it from its current location before continuing.'
    );
  return adapter;
}
