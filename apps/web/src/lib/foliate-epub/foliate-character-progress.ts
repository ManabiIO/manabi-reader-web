/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { getCharacterCount } from '$lib/functions/get-character-count';
import {
  countReadingCharacters,
  isReadingCharacter
} from '$lib/functions/count-reading-characters';
import { getParagraphNodes } from '$lib/components/book-reader/get-paragraph-nodes';

export {
  exploredCountAtParagraph,
  sectionIndexForCharacterCount
} from './foliate-character-progress-core';
import { sectionIndexForCharacterCount } from './foliate-character-progress-core';

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

  private firstVisiblePoint(
    sectionIndex: number,
    content: Element,
    visibleRange?: Range | null
  ): { count: number; node?: Node } {
    const start = this.sectionStart(sectionIndex);
    if (!visibleRange) return { count: start };
    let count = start;
    // A viewport can intersect many nodes. An arbitrary binary-search match
    // advances progress into unread text and changes when the chapter grows.
    // Stop at the first overlap in source order, keeping TTU's whole-node count.
    for (const node of getParagraphNodes(content)) {
      const touchesTextBoundary =
        !visibleRange.collapsed &&
        node.nodeType === 3 &&
        ((visibleRange.startContainer === node &&
          visibleRange.startOffset === (node.textContent?.length ?? 0)) ||
          (visibleRange.endContainer === node && visibleRange.endOffset === 0));
      if (!touchesTextBoundary && visibleRange.intersectsNode(node)) return { count, node };
      count += getCharacterCount(node);
    }
    return { count: start };
  }

  exploredCharacterCount(
    sectionIndex: number,
    content: Element,
    visibleRange?: Range | null
  ): number {
    return this.firstVisiblePoint(sectionIndex, content, visibleRange).count;
  }

  /** Bookmarks need the visible point inside a long text node; tracker progress stays whole-node. */
  bookmarkCharacterCount(
    sectionIndex: number,
    content: Element,
    visibleRange?: Range | null
  ): number {
    const { count, node } = this.firstVisiblePoint(sectionIndex, content, visibleRange);
    // The range may start in ruby annotations or hidden text that the reader
    // does not count. Only refine the same admitted node as the base count.
    if (!visibleRange || node?.nodeType !== 3 || visibleRange.startContainer !== node) return count;
    return (
      count + countReadingCharacters(node.textContent?.slice(0, visibleRange.startOffset) ?? '')
    );
  }

  rangeForCharacterCount(
    sectionIndex: number,
    content: Element,
    characterCount: number
  ): Range | undefined {
    if (!Number.isFinite(characterCount)) return undefined;
    const paragraphs = getParagraphNodes(content);
    if (!paragraphs.length) return undefined;
    const local = Math.max(0, characterCount - this.sectionStart(sectionIndex));
    let accumulated = 0;
    let target = paragraphs[0];
    let within = 0;
    let atEnd = true;
    for (const paragraph of paragraphs) {
      target = paragraph;
      const length = getCharacterCount(paragraph);
      if (local < accumulated + length) {
        within = local - accumulated;
        atEnd = false;
        break;
      }
      accumulated += length;
    }
    const range = content.ownerDocument.createRange();
    if (target.nodeType === 3) {
      const text = target.textContent ?? '';
      // A count at/beyond section end must not reset to the start of its last
      // paragraph. The source end also includes trailing uncounted punctuation.
      let offset = atEnd ? text.length : 0;
      let remaining = within;
      if (!atEnd) {
        for (const character of text) {
          if (remaining <= 0) break;
          offset += character.length;
          if (isReadingCharacter(character)) remaining--;
        }
      }
      range.setStart(target, offset);
      range.collapse(true);
    } else {
      range.selectNodeContents(target);
      range.collapse(true);
    }
    return range;
  }
}
