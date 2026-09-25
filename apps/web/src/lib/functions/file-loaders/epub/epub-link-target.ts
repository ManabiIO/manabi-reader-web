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
  resources: readonly PublicationResource[]
): EpubLinkTarget | undefined {
  if (!ownerHref || !rawHref) return undefined;
  const hashIndex = rawHref.indexOf('#');
  const resourceReference = (hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref).split('?', 1)[0];
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
  const resource = resources.find((candidate) => candidate.href === href);
  if (!resource) return undefined;
  return {
    spineIndex: resource.spineIndex,
    ...(fragment ? { fragment } : {})
  };
}
