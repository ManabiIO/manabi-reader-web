/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { binarySearchNodeInRange } from '$lib/functions/binary-search';
import { getCharacterCount } from '$lib/functions/get-character-count';
import { getParagraphNodes } from '$lib/components/book-reader/get-paragraph-nodes';

export {
  exploredCountAtParagraph,
  sectionIndexForCharacterCount
} from './foliate-character-progress-core';
import {
  exploredCountAtParagraph,
  sectionIndexForCharacterCount
} from './foliate-character-progress-core';

/**
 * Preserve the existing TTU paragraph-character progress contract while a
 * Foliate paginator owns geometry. Foliate ranges are renderer coordinates;
 * stored progress remains the historical global explored-character count.
 */
export class FoliateCharacterProgress {
  readonly bookCharacterCount: number;
  readonly sectionEnds: number[];

  constructor(sourceSections: readonly Element[]) {
    let total = 0;
    this.sectionEnds = sourceSections.map((section) => {
      total += getParagraphNodes(section).reduce(
        (count, paragraph) => count + getCharacterCount(paragraph),
        0
      );
      return total;
    });
    this.bookCharacterCount = total;
  }

  sectionStart(index: number): number {
    return this.sectionEnds[index - 1] ?? 0;
  }

  sectionForCharacterCount(characterCount: number): number {
    return sectionIndexForCharacterCount(this.sectionEnds, characterCount);
  }

  exploredCharacterCount(
    sectionIndex: number,
    content: Element,
    visibleRange?: Range | null
  ): number {
    const paragraphs = getParagraphNodes(content);
    if (!visibleRange || !paragraphs.length) return this.sectionStart(sectionIndex);
    const paragraphIndex = binarySearchNodeInRange(paragraphs, visibleRange);
    if (paragraphIndex < 0) return this.sectionStart(sectionIndex);
    let accumulated = 0;
    const counts = paragraphs.map((paragraph) => {
      accumulated += getCharacterCount(paragraph);
      return accumulated;
    });
    return exploredCountAtParagraph(this.sectionStart(sectionIndex), counts, paragraphIndex);
  }

  rangeForCharacterCount(
    sectionIndex: number,
    content: Element,
    characterCount: number
  ): Range | undefined {
    const paragraphs = getParagraphNodes(content);
    if (!paragraphs.length) return undefined;
    const local = Math.max(0, characterCount - this.sectionStart(sectionIndex));
    let accumulated = 0;
    let target = paragraphs[0];
    for (const paragraph of paragraphs) {
      target = paragraph;
      accumulated += getCharacterCount(paragraph);
      if (local < accumulated) break;
    }
    const range = content.ownerDocument.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    return range;
  }
}
