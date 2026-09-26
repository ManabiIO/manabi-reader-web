/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationResource } from '$lib/reader-location';
import { resolveArchivePath } from '../utils/limited-archive.ts';

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

/** Keep a navigation URI encoded until its resource and fragment are separated. */
export function resolveEpubNavigationHref(owner: string, reference: string): string {
  if (/^(?:[a-z][\w+.-]*:|[\\/])/i.test(reference)) return reference;
  const hash = reference.indexOf('#');
  const target = (hash < 0 ? reference : reference.slice(0, hash)).split('?', 1)[0];
  const resource = target ? resolveArchivePath(owner, target) : owner;
  const encoded = resource.split('/').map(encodeURIComponent).join('/');
  return hash < 0 ? encoded : `${encoded}${reference.slice(hash)}`;
}
