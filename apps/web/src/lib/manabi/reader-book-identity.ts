/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { RestoredContent } from '../functions/file-loaders/utils/restored-book';
import { canonical } from './ttu-migration-format.ts';

async function hash(value: Blob | string) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : await value.arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/** One content identity for existing import receipts and continuous-reader links.
 * Call only after bounded package decoding; ZIP bytes and claimed contentHash
 * fields are not identities. This preserves the existing receipt hash format. */
export async function identifyReaderBook(
  data: RestoredContent,
  declaredCharacters: number,
  signal?: AbortSignal
): Promise<{ fingerprint: string; characters: number }> {
  signal?.throwIfAborted();
  const characters =
    declaredCharacters ||
    Math.max(
      0,
      ...data.sections.map((section) => (section.startCharacter ?? 0) + (section.characters ?? 0))
    );
  if (
    !Number.isSafeInteger(declaredCharacters) ||
    declaredCharacters < 0 ||
    !Number.isSafeInteger(characters) ||
    characters < 0
  )
    throw new Error('Invalid book character count.');
  // Capture nested metadata and immutable Blob references before awaiting. A
  // concurrent caller mutation must not attach old media to a different book.
  const content = structuredClone({
    html: data.elementHtml,
    css: data.styleSheet,
    ...(data.epubPublication ? { epubPublication: data.epubPublication } : {}),
    sections: data.sections,
    language: data.language,
    creators: data.creators,
    metadata: data.metadata,
    pageDirection: data.pageDirection,
    characters
  });
  const selected = Object.keys(data.blobs)
    .sort()
    .map((name) => [name, data.blobs[name]] as const);
  const cover = data.coverImage;
  const media: [string, string][] = [];
  for (const [name, blob] of selected) {
    signal?.throwIfAborted();
    media.push([name, await hash(blob)]);
  }
  signal?.throwIfAborted();
  const fingerprint = await hash(
    canonical({ ...content, media, cover: cover ? await hash(cover) : null })
  );
  signal?.throwIfAborted();
  return { fingerprint, characters };
}
