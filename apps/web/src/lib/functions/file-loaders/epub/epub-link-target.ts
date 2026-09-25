/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationResource } from '$lib/reader-location';
import { resolveArchivePath } from '../utils/limited-archive';

export interface EpubLinkTarget {
  spineIndex: number;
  fragment?: string;
}

export function resolveEpubLinkTarget(
  ownerHref: string,
  rawHref: string,
  resources: readonly PublicationResource[],
  ownerSpineIndex?: number
): EpubLinkTarget | undefined {
  if (!ownerHref || !rawHref) return undefined;
  const hashIndex = rawHref.indexOf('#');
  const resourceReference = (hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref).split(
    '?',
    1
  )[0];
  let fragment = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : '';
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // Keep malformed fragment text inert but deterministic.
  }

  let href: string;
  try {
    href = resourceReference ? resolveArchivePath(ownerHref, resourceReference) : ownerHref;
  } catch {
    return undefined;
  }
  const candidates = resources.filter((candidate) => candidate.href === href);
  if (!candidates.length) return undefined;
  const resource =
    href === ownerHref && Number.isSafeInteger(ownerSpineIndex)
      ? (candidates.find((candidate) => candidate.spineIndex === ownerSpineIndex) ?? candidates[0])
      : Number.isSafeInteger(ownerSpineIndex)
        ? candidates.reduce((nearest, candidate) =>
            Math.abs(candidate.spineIndex - ownerSpineIndex!) <
            Math.abs(nearest.spineIndex - ownerSpineIndex!)
              ? candidate
              : nearest
          )
        : candidates[0];
  return {
    spineIndex: resource.spineIndex,
    ...(fragment ? { fragment } : {})
  };
}
