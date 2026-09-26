/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export function sectionIndexForCharacterCount(
  sectionEnds: readonly number[],
  characterCount: number
): number {
  if (!sectionEnds.length) return -1;
  const target = Math.max(0, characterCount);
  const index = sectionEnds.findIndex((end) => target < end);
  return index < 0 ? sectionEnds.length - 1 : index;
}

export function exploredCountAtParagraph(
  sectionStart: number,
  accumulatedParagraphCounts: readonly number[],
  paragraphIndex: number
): number {
  if (paragraphIndex <= 0) return sectionStart;
  return sectionStart + (accumulatedParagraphCounts[paragraphIndex - 1] ?? 0);
}
