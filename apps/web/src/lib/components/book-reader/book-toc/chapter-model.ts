/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { SectionWithProgress } from './book-toc';

/** Keep the existing first-unfinished/last-finished convention. Missing or
 * orphaned sections must not invent a current chapter or enable navigation. */
export function getChapterData(
  sectionData: readonly SectionWithProgress[]
): [SectionWithProgress[], number, string] {
  const mainChapters = sectionData.filter((section) => !section.parentChapter);
  const currentSection =
    sectionData.find((section) => section.progress < 100) ?? sectionData.at(-1);
  const referenceId = currentSection?.parentChapter || currentSection?.reference || '';
  const currentChapterIndex = currentSection
    ? mainChapters.findIndex((section) => section.reference === referenceId)
    : -1;
  return [mainChapters, currentChapterIndex, referenceId];
}

export function adjacentChapterIndex(length: number, current: number, offset: number): number {
  if (
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(current) ||
    current < 0 ||
    current >= length ||
    (offset !== -1 && offset !== 1)
  ) {
    return -1;
  }
  const index = current + offset;
  return index >= 0 && index < length ? index : -1;
}

/** Unknown progress is not zero progress. In particular, legacy backups may
 * legitimately contain zero section weights; never expose NaN as ARIA/CSS. */
export function chapterPercentage(
  sections: readonly SectionWithProgress[],
  reference: string
): number | undefined {
  let sum = 0;
  let weight = 0;
  for (const section of sections) {
    if (section.reference !== reference && section.parentChapter !== reference) continue;
    if (
      !Number.isFinite(section.progress) ||
      section.progress < 0 ||
      section.progress > 100 ||
      !Number.isFinite(section.charactersWeight) ||
      section.charactersWeight < 0
    ) {
      return undefined;
    }
    sum += section.progress * section.charactersWeight;
    weight += section.charactersWeight;
  }
  const percentage = sum / weight;
  return Number.isFinite(percentage) ? Math.min(Math.max(percentage, 0), 100) : undefined;
}

export function chapterCharacters(
  chapter: SectionWithProgress | undefined,
  explored: number
): { read: number; total: number } | undefined {
  const start = chapter?.startCharacter;
  const total = chapter?.characters;
  if (
    start === undefined ||
    total === undefined ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    total < 0 ||
    !Number.isFinite(explored)
  ) {
    return undefined;
  }
  return { read: Math.min(Math.max(explored - start, 0), total), total };
}
