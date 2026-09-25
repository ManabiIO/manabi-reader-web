/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { EPUB } from './epub.js';
import {
  LimitedArchive,
  validateArchivePath
} from '$lib/functions/file-loaders/utils/limited-archive';

export interface FoliatePublicationSectionSnapshot {
  href: string;
  spineIndex: number;
  linear?: string;
  cfi?: string;
  pageSpread?: string;
}

export interface FoliatePublicationSnapshot {
  sections: FoliatePublicationSectionSnapshot[];
  toc: unknown[];
  pageList: unknown[];
  landmarks: unknown[];
  metadata: Record<string, unknown>;
  rendition: Record<string, unknown>;
  dir?: string;
}

/**
 * Foliate resolves package hrefs before asking the archive loader for bytes.
 * ZIP entry names can legally contain escaped characters, so index a validated
 * decoded spelling in addition to the literal ZIP key. Ambiguous spellings are
 * rejected instead of allowing one resource to shadow another.
 */
export function foliateArchiveEntryIndex(
  entries: ReadonlyMap<string, { uncompressedSize?: number }>
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const literal of entries.keys()) {
    const candidates = new Set([literal]);
    try {
      candidates.add(validateArchivePath(decodeURI(literal)));
    } catch {
      // The literal name was already validated by LimitedArchive. A malformed
      // alternate URI spelling simply is not addressable through that alias.
    }
    for (const candidate of candidates) {
      const existing = result.get(candidate);
      if (existing && existing !== literal)
        throw new Error(`Ambiguous EPUB resource path: ${candidate}`);
      result.set(candidate, literal);
    }
  }
  return result;
}

export async function readFoliatePublicationSnapshot(
  file: Blob,
  signal?: AbortSignal
): Promise<FoliatePublicationSnapshot> {
  const archive = await LimitedArchive.open(file, { signal });
  const index = foliateArchiveEntryIndex(archive.entries);
  const literalName = (name: string) => index.get(name);

  const loader = {
    loadText: async (name: string) => {
      const literal = literalName(name);
      return literal ? archive.readText(literal) : null;
    },
    loadBlob: async (name: string) => {
      const literal = literalName(name);
      return literal ? archive.readBlob(literal) : null;
    },
    getSize: (name: string) => {
      const literal = literalName(name);
      return literal ? archive.entries.get(literal)?.uncompressedSize ?? 0 : 0;
    }
  };

  const publication = new EPUB(loader);
  try {
    await publication.init();
    signal?.throwIfAborted();
    return {
      sections: publication.sections.map((section: any, spineIndex: number) => ({
        href: String(section.id ?? ''),
        spineIndex,
        ...(section.linear ? { linear: String(section.linear) } : {}),
        ...(section.cfi ? { cfi: String(section.cfi) } : {}),
        ...(section.pageSpread ? { pageSpread: String(section.pageSpread) } : {})
      })),
      toc: publication.toc ?? [],
      pageList: publication.pageList ?? [],
      landmarks: publication.landmarks ?? [],
      metadata: publication.metadata ?? {},
      rendition: publication.rendition ?? {},
      dir: publication.dir ?? undefined
    };
  } finally {
    publication.destroy?.();
    await archive.close();
  }
}
