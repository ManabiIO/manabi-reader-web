/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Read bounded optional metadata without buffering a dishonest Content-Length response. */
export async function boundedBytes(response: Response, maximum: number): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 128 * 1024 * 1024)
    throw new Error('Invalid byte limit.');
  if (Number(response.headers.get('Content-Length')) > maximum) {
    await response.body?.cancel();
    throw new Error('Response is too large.');
  }
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) throw new Error('Response is too large.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
