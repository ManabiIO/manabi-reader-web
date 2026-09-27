/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Engine } from './queue.js';

/** Scope best-effort parsing/rendering to one inference, including custom engines.
 * Closing the preview never changes authoritative inference success or failure.
 * Worker protocol and final-output validation remain the caller's responsibility.
 */
export async function transcribeWithPreview(
  engine: Pick<Engine, 'transcribe'>,
  pcm: Float32Array,
  signal: AbortSignal,
  observer?: (text: string) => void
): Promise<string> {
  signal.throwIfAborted();
  let accepting = true;
  try {
    return await engine.transcribe(
      pcm,
      signal,
      observer
        ? (text) => {
            if (!accepting || signal.aborted) return;
            try {
              observer(text);
            } catch {
              // A malformed provisional cue or a failed renderer must not unwind
              // healthy recognition. Suppress further previews for this inference.
              accepting = false;
            }
          }
        : undefined
    );
  } finally {
    accepting = false;
  }
}
