/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  makeLocator,
  projectResource,
  selectedOffsets,
  type PublicationResource,
  type ReaderLocator
} from '../reader-location.ts';

/** Use the renderer's clipped visible range, not its chapter-sized iframe viewport. */
export class VisibleReaderLocation {
  private current?: { content: Element; resource: PublicationResource; range?: Range };

  clear(): void {
    this.current = undefined;
  }

  update(content: Element, resource: PublicationResource, range?: Range): void {
    this.current = { content, resource: { ...resource }, range: range?.cloneRange() };
  }

  async capture(bookKey: string): Promise<ReaderLocator | undefined> {
    const current = this.current;
    if (!current || !current.content.isConnected) return undefined;
    const { content, resource, range } = current;
    const projected = projectResource(content, resource);
    let start = 0;
    if (projected.runs.length) {
      if (!range || !content.contains(range.commonAncestorContainer)) return undefined;
      const offsets = selectedOffsets(projected, range);
      if (!offsets) return undefined;
      start = offsets.start;
    }
    const result = await makeLocator(bookKey, projected, start);
    return this.current === current && content.isConnected ? result : undefined;
  }
}
