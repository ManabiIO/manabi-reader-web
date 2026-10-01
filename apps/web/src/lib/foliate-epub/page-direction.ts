/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export function paginatedPageRtl({
  flow,
  vertical,
  bookDirection,
  contentRtl
}: {
  flow: string | null;
  vertical: boolean;
  bookDirection?: string;
  contentRtl: boolean;
}): boolean {
  if (flow === 'scrolled' || vertical) return contentRtl;
  if (bookDirection === 'rtl') return true;
  if (bookDirection === 'ltr') return false;
  return contentRtl;
}

export function reversesPhysicalPageTurns(
  vertical: boolean,
  pageDirection: 'ltr' | 'rtl' | 'unknown' | undefined
): boolean {
  return vertical || (!vertical && pageDirection === 'rtl');
}
