/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { importHTMLFixMode$, restrictImportFixToAnchor$ } from '$lib/data/store';
import { importEpubPublication } from '$lib/foliate-epub/import-publication';
import type { LoadData } from '../types';
import initZipSettings from '../utils/init-zip-settings';

export default function loadEpub(
  file: File,
  document: Document,
  lastBookModified: number,
  signal?: AbortSignal
): Promise<LoadData> {
  initZipSettings();
  return importEpubPublication(file, document, lastBookModified, {
    signal,
    repairMode: importHTMLFixMode$.getValue(),
    anchorsOnly: restrictImportFixToAnchor$.getValue()
  });
}
