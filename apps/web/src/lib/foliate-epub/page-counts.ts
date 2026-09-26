/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface PageNumber {
  current?: number;
  total?: number;
  percentage: number;
}

/** A current page is exact once every preceding chapter has been measured. */
export function pageNumber(
  counts: readonly (number | undefined)[],
  index: number,
  localPage: number,
  localPages: number,
  weights: readonly number[] = []
): PageNumber {
  const preceding = counts.slice(0, index);
  const current =
    index >= 0 && index < counts.length && preceding.every((count) => count !== undefined)
      ? preceding.reduce<number>((sum, count) => sum + count!, 0) + Math.max(1, localPage)
      : undefined;
  const total =
    counts.length && counts.every((count) => count !== undefined)
      ? counts.reduce<number>((sum, count) => sum + count!, 0)
      : undefined;
  const sizes = counts.map((_, i) => Math.max(1, weights[i] || 1));
  const size = sizes.reduce((sum, value) => sum + value, 0);
  const position =
    sizes.slice(0, index).reduce((sum, value) => sum + value, 0) +
    (sizes[index] || 0) * Math.max(0, Math.min(1, (localPage - 1) / Math.max(1, localPages)));
  return { current, total, percentage: size ? Math.floor((position / size) * 100) : 0 };
}

export function pageNumberLabel(value: PageNumber, expanded: boolean): string {
  if (value.current === undefined) return `${value.percentage}%`;
  return expanded && value.total !== undefined
    ? `${value.current} of ${value.total}`
    : String(value.current);
}

function idle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let cancel: () => void;
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      cancel();
      finish();
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(finish, { timeout: 250 });
      cancel = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(finish, 0);
      cancel = () => clearTimeout(id);
    }
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Bounded, per-book layout cache. Only one background chapter is measured at a time. */
export class PageCountCache {
  private layouts = new Map<string, (number | undefined)[]>();
  private controller?: AbortController;
  private key?: string;
  private disposed = false;
  counts: (number | undefined)[] = [];
  settled: Promise<void> = Promise.resolve();
  private length: number;
  private measure: (index: number, signal: AbortSignal) => Promise<number>;
  private changed: () => void;
  private failed: (error: unknown) => void;
  private yieldWork: (signal: AbortSignal) => Promise<void>;

  constructor(
    length: number,
    measure: (index: number, signal: AbortSignal) => Promise<number>,
    changed: () => void,
    failed: (error: unknown) => void = () => {},
    yieldWork: (signal: AbortSignal) => Promise<void> = idle
  ) {
    this.length = length;
    this.measure = measure;
    this.changed = changed;
    this.failed = failed;
    this.yieldWork = yieldWork;
  }

  useLayout(key: string, index: number, pages: number) {
    if (this.disposed) return;
    if (this.key !== key) {
      this.controller?.abort();
      this.controller = undefined;
      this.key = key;
      this.counts = this.layouts.get(key) ?? Array(this.length).fill(undefined);
      this.layouts.delete(key);
      this.layouts.set(key, this.counts);
      if (this.layouts.size > 4) this.layouts.delete(this.layouts.keys().next().value!);
    }
    this.record(index, pages);
    this.changed();
    if (this.controller || this.counts.every((count) => count !== undefined)) return;
    const controller = new AbortController();
    const counts = this.counts;
    this.controller = controller;
    this.settled = (async () => {
      try {
        for (let i = 0; i < counts.length; i++) {
          if (counts[i] !== undefined) continue;
          await this.yieldWork(controller.signal);
          if (controller.signal.aborted) return;
          const count = await this.measure(i, controller.signal);
          if (controller.signal.aborted) return;
          this.record(i, count);
        }
      } catch (error) {
        if (!controller.signal.aborted) this.failed(error);
      } finally {
        if (this.controller === controller) this.controller = undefined;
      }
    })();
  }

  record(index: number, pages: number) {
    if (
      this.disposed ||
      index < 0 ||
      index >= this.counts.length ||
      !Number.isSafeInteger(pages) ||
      pages < 1 ||
      this.counts[index] === pages
    )
      return;
    this.counts[index] = pages;
    this.changed();
  }

  destroy() {
    this.disposed = true;
    this.controller?.abort();
    this.layouts.clear();
  }
}
