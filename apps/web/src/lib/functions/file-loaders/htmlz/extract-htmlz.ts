/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import initZipSettings from '../utils/init-zip-settings';
import { LimitedArchive, type ArchiveOptions } from '../utils/limited-archive';
import type { HtmlzContent } from './types';

initZipSettings();

export default async function extract(blob: Blob, options: ArchiveOptions = {}) {
  const archive = await LimitedArchive.open(blob, options);
  try {
    const result: HtmlzContent = Object.assign(Object.create(null), {
      'index.html': '',
      'metadata.opf': '',
      'style.css': ''
    });
    await archive.map([...archive.entries], async ([name, entry]) => {
      if (entry.directory) return;
      result[name] = ['index.html', 'metadata.opf', 'style.css'].includes(name)
        ? await archive.readText(name)
        : await archive.readBlob(name, getMimeTypeFromName(name));
    });
    if (!result['index.html']) throw new Error('HTMLZ archive has no index.html');
    return result;
  } finally {
    await archive.close();
  }
}

function getMimeTypeFromName(filename: string): string | undefined {
  // image/gif, image/png, image/jpeg, image/bmp, image/webp
  const regexResult = /.*\.([^.]+)$/.exec(filename);
  if (regexResult) {
    switch (regexResult[1].toLowerCase()) {
      case 'gif':
        return 'image/gif';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
      case 'jfif':
      case 'jfi':
        return 'image/jpeg';
      case 'bmp':
        return 'image/bmp';
      case 'webp':
        return 'image/webp';
    }
  }
  return undefined;
}
