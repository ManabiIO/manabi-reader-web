/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { getEntryFiles } from './get-entry-files';

export async function getDropEventFiles(ev: DragEvent): Promise<File[]> {
  const transfer = ev.dataTransfer;
  if (!transfer) return [];

  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file');
  if (!items.length) return Array.from(transfer.files);

  // Capture entries and fallback Files while the drop data store is still readable.
  // An unavailable Entries API must not discard an otherwise usable plain file.
  const pending = items.map((item) => {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) return getEntryFiles(entry);

    const file = item.getAsFile();
    return Promise.resolve(file ? [file] : []);
  });

  return (await Promise.all(pending)).flat();
}
