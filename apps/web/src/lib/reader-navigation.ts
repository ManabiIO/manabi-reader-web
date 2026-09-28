/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { snapshotReaderLocator, type ReaderLocator } from './reader-location.ts';

export type ReaderNavigationCause =
  | 'reading'
  | 'jump-preview'
  | 'history-return'
  | 'restore'
  | 'reflow'
  | 'audio-follow';

/** Per-open-book navigation. Preview jumps never replace the saved resume position. */
export interface ReaderNavigationRequest {
  isCurrent(): boolean;
}

export class ReaderNavigation {
  private origin: ReaderLocator | undefined;
  private visible: ReaderLocator | undefined;
  private targets: ReaderLocator[] = [];
  private requestGeneration = 0;

  beginRequest(): ReaderNavigationRequest {
    const generation = ++this.requestGeneration;
    return { isCurrent: () => generation === this.requestGeneration };
  }

  private own(locator: ReaderLocator): ReaderLocator {
    const value = snapshotReaderLocator(locator);
    if (!value) throw new Error('Invalid reader location.');
    return value;
  }

  private invalidateRequests() {
    this.requestGeneration += 1;
  }

  get previewing() {
    return !!this.origin;
  }

  get returnPoint() {
    return this.origin ? this.own(this.origin) : undefined;
  }

  get visiblePoint() {
    return this.visible ? this.own(this.visible) : undefined;
  }

  preview(from: ReaderLocator, target: ReaderLocator) {
    const ownedFrom = this.own(from);
    const ownedTarget = this.own(target);
    if (ownedFrom.bookKey !== ownedTarget.bookKey)
      throw new Error('Cannot navigate between different books.');
    this.origin ??= ownedFrom;
    this.visible = ownedTarget;
    this.targets.push(ownedTarget);
    if (this.targets.length > 32) this.targets.shift();
  }

  returnToOrigin(): ReaderLocator | undefined {
    this.invalidateRequests();
    const point = this.origin;
    this.origin = undefined;
    this.visible = point;
    this.targets = [];
    return point ? this.own(point) : undefined;
  }

  continueHere(): ReaderLocator | undefined {
    this.invalidateRequests();
    const point = this.visible;
    this.origin = undefined;
    this.targets = [];
    return point ? this.own(point) : undefined;
  }

  clear() {
    this.invalidateRequests();
    this.origin = undefined;
    this.visible = undefined;
    this.targets = [];
  }
}
