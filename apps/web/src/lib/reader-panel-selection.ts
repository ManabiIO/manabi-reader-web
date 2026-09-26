/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A locator must still belong to the open panel and the latest user choice
 * after its asynchronous resource digest completes. Invalidating on dismissal
 * also fences a previous opening when the same panel is reopened. */
export class ReaderPanelSelection {
  private generation = 0;
  private disposed = false;

  invalidate() {
    this.generation += 1;
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
  }

  async run<T>(
    prepare: () => Promise<T>,
    isCurrent: () => boolean,
    receive: (value: T) => void,
    fail: (error: unknown) => void
  ): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const current = () => !this.disposed && generation === this.generation && isCurrent();
    try {
      const value = await prepare();
      if (current()) receive(value);
    } catch (error) {
      if (current()) fail(error);
    }
  }
}
