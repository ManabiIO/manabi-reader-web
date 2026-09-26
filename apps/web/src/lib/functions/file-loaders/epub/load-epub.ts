/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { importEpubPublication } from '$lib/foliate-epub/import-publication';
import { importHTMLFixMode$, restrictImportFixToAnchor$ } from '$lib/data/store';
import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';
import type { LoadData } from '../types';
import initZipSettings from '../utils/init-zip-settings';

export default async function loadEpub(
  file: File,
  document: Document,
  lastBookModified: number,
  signal?: AbortSignal
): Promise<LoadData> {
  initZipSettings();
  const mode = importHTMLFixMode$.getValue();
  return importEpubPublication(
    file,
    document,
    lastBookModified,
    {
      mode:
        mode === ImportHTMLFixMode.OFF
          ? 'off'
          : mode === ImportHTMLFixMode.EXTENDED
            ? 'extended'
            : 'basic',
      anchorsOnly: restrictImportFixToAnchor$.getValue()
    },
    signal
  );
}
