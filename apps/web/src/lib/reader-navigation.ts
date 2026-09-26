/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReaderLocator } from './reader-location';

export type ReaderNavigationCause =
  | 'reading'
  | 'jump-preview'
  | 'history-return'
  | 'restore'
  | 'reflow'
  | 'audio-follow';

/** Per-open-book navigation. Preview jumps never replace the saved resume position. */
export class ReaderNavigation {
  private origin: ReaderLocator | undefined;
  private visible: ReaderLocator | undefined;
  private targets: ReaderLocator[] = [];

  get previewing() {
    return !!this.origin;
  }

  get returnPoint() {
    return this.origin;
  }

  get visiblePoint() {
    return this.visible;
  }

  preview(from: ReaderLocator, target: ReaderLocator) {
    if (from.bookKey !== target.bookKey)
      throw new Error('Cannot navigate between different books.');
    this.origin ??= from;
    this.visible = target;
    this.targets.push(target);
    if (this.targets.length > 32) this.targets.shift();
  }

  returnToOrigin(): ReaderLocator | undefined {
    const point = this.origin;
    this.origin = undefined;
    this.visible = point;
    this.targets = [];
    return point;
  }

  continueHere(): ReaderLocator | undefined {
    const point = this.visible;
    this.origin = undefined;
    this.targets = [];
    return point;
  }

  clear() {
    this.origin = undefined;
    this.visible = undefined;
    this.targets = [];
  }
}
