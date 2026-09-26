/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface EpubNavigationItem {
  label: string;
  href?: string;
  type?: string[];
  subitems?: EpubNavigationItem[];
}

export interface EpubPublicationDescriptor {
  version: 1;
  engine: 'foliate-epub-v1';
  parser: 'foliate' | 'legacy';
  toc: EpubNavigationItem[];
  pageList: EpubNavigationItem[];
  landmarks: EpubNavigationItem[];
  rendition: Record<string, string | number | boolean | null>;
}

function normalizeType(value: unknown): string[] | undefined {
  const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : [];
  const result = input.filter((item): item is string => typeof item === 'string' && !!item);
  return result.length ? result : undefined;
}

function normalizeItem(value: unknown, depth = 0): EpubNavigationItem | undefined {
  if (!value || typeof value !== 'object' || depth > 32) return;
  const record = value as Record<string, unknown>;
  const label =
    typeof record.label === 'string'
      ? record.label
      : typeof record.title === 'string'
        ? record.title
        : '';
  const href = typeof record.href === 'string' && record.href.length <= 4096 ? record.href : undefined;
  const type = normalizeType(record.type);
  const rawSubitems = Array.isArray(record.subitems) ? record.subitems : [];
  const subitems = rawSubitems
    .map((item) => normalizeItem(item, depth + 1))
    .filter((item): item is EpubNavigationItem => !!item);
  if (!label && !href && !subitems.length) return;
  return {
    label,
    ...(href ? { href } : {}),
    ...(type ? { type } : {}),
    ...(subitems.length ? { subitems } : {})
  };
}

export function normalizeEpubNavigation(value: unknown): EpubNavigationItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20000)
    .map((item) => normalizeItem(item))
    .filter((item): item is EpubNavigationItem => !!item);
}

export function makeEpubPublicationDescriptor(input: {
  parser: 'foliate' | 'legacy';
  toc?: unknown;
  pageList?: unknown;
  landmarks?: unknown;
  rendition?: Record<string, unknown>;
}): EpubPublicationDescriptor {
  const rendition: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input.rendition ?? {})) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    )
      rendition[key] = value;
  }
  return {
    version: 1,
    engine: 'foliate-epub-v1',
    parser: input.parser,
    toc: normalizeEpubNavigation(input.toc),
    pageList: normalizeEpubNavigation(input.pageList),
    landmarks: normalizeEpubNavigation(input.landmarks),
    rendition
  };
}
