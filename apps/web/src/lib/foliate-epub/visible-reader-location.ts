/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  codePointLength,
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

  private position(range?: Range) {
    const current = this.current;
    if (!current || !current.content.isConnected) return undefined;
    const { content, resource } = current;
    range ??= current.range;
    const projected = projectResource(content, resource);
    let start = 0;
    if (projected.runs.length) {
      if (!range || !content.contains(range.commonAncestorContainer)) return undefined;
      const selection = range.cloneRange();
      // A collapsed custom point can sit at a text or element boundary. Extend
      // only the measuring copy to find the next canonical run (or source end).
      if (selection.collapsed) selection.setEnd(content, content.childNodes.length);
      const offsets = selectedOffsets(projected, selection);
      if (!offsets && !range.collapsed) return undefined;
      start = offsets?.start ?? codePointLength(projected.text);
    }
    return { current, projected, start };
  }

  async capture(bookKey: string): Promise<ReaderLocator | undefined> {
    const position = this.position();
    if (!position) return undefined;
    const { current, projected, start } = position;
    const result = await makeLocator(bookKey, projected, start);
    return this.current === current && current.content.isConnected ? result : undefined;
  }

  /** Explicit Save retains its initiating point even if reading advances while
   * identity/digest work waits. The save coordinator owns revocation/ordering. */
  async snapshot(bookIdentity: Promise<string>, range?: Range): Promise<ReaderLocator | undefined> {
    const position = this.position(range);
    if (!position) return undefined;
    const bookKey = await bookIdentity;
    if (!bookKey) return undefined;
    return makeLocator(bookKey, position.projected, position.start);
  }
}
