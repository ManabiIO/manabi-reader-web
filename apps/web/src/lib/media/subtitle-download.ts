/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { serializeSubtitles, exportName } from './captions.js';
import type { Track } from './contracts.js';

/** Explicit local download, never a write to the source video or its provider. */
export function downloadSubtitles(name: string, track: Track): void {
  const url = URL.createObjectURL(
    new Blob([serializeSubtitles(track, 'srt')], {
      type: 'application/x-subrip;charset=utf-8'
    })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportName(name, track, 'srt');
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
