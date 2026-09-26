/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationManifest, PublicationResource } from '$lib/reader-location';
import { resolveArchivePath } from './utils/limited-archive';

export interface EpubResolvedTarget {
  resource: PublicationResource;
  fragment: string;
}

export interface EpubNavigationRequest {
  sourceSpineIndex: number;
  href: string;
}

function splitReference(href: string): { resourceHref: string; fragment: string } {
  const hash = href.indexOf('#');
  const beforeHash = hash >= 0 ? href.slice(0, hash) : href;
  const fragment = hash >= 0 ? href.slice(hash + 1) : '';
  const query = beforeHash.indexOf('?');
  return {
    resourceHref: (query >= 0 ? beforeHash.slice(0, query) : beforeHash),
    fragment
  };
}

/**
 * Resolve an imported internal EPUB link without collapsing resource identity.
 * A same-resource fragment keeps the exact spine occurrence. Cross-resource
 * references choose the closest occurrence, which is deterministic for books
 * that repeat one manifest item in the spine.
 */
export function resolveEpubTarget(
  manifest: PublicationManifest | undefined,
  request: EpubNavigationRequest
): EpubResolvedTarget | undefined {
  const resources = manifest?.resources ?? [];
  if (!Number.isSafeInteger(request.sourceSpineIndex) || request.sourceSpineIndex < 0) return;
  const source = resources[request.sourceSpineIndex];
  if (!source || typeof request.href !== 'string' || !request.href) return;

  const { resourceHref, fragment } = splitReference(request.href);
  let targetHref = source.href;
  if (resourceHref) {
    try {
      targetHref = resolveArchivePath(source.href, resourceHref);
    } catch {
      return;
    }
  }

  if (targetHref === source.href) return { resource: source, fragment };

  let target: PublicationResource | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const resource of resources) {
    if (resource.href !== targetHref) continue;
    const candidateDistance = Math.abs(resource.spineIndex - source.spineIndex);
    if (candidateDistance < distance) {
      target = resource;
      distance = candidateDistance;
    }
  }
  return target ? { resource: target, fragment } : undefined;
}
