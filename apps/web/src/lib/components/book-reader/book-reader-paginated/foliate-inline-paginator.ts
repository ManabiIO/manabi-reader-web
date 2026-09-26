/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Pagination geometry is derived from Foliate.js' CSS-column paginator while
 * retaining Manabi Reader Web's same-document reading surface.
 */

export type InlinePaginationAxis = 'horizontal' | 'vertical';

export interface InlinePaginationMetrics {
  viewport: number;
  extent: number;
  gap: number;
}

export interface InlinePageTarget {
  position: number;
  page: number;
  pages: number;
  moved: boolean;
  boundary: -1 | 0 | 1;
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

export function inlinePageSize(metrics: InlinePaginationMetrics): number {
  return Math.max(1, finite(metrics.viewport) + Math.max(0, finite(metrics.gap)));
}

/**
 * CSS columns can end in a partial physical viewport. Like Foliate, model
 * logical pages rather than clamping immediately to scrollWidth-clientWidth;
 * the horizontal renderer may translate the final partial page into place.
 */
export function inlinePageCount(metrics: InlinePaginationMetrics): number {
  const size = inlinePageSize(metrics);
  return Math.max(1, Math.ceil(Math.max(0, finite(metrics.extent)) / size));
}

export function inlineLastPagePosition(metrics: InlinePaginationMetrics): number {
  return (inlinePageCount(metrics) - 1) * inlinePageSize(metrics);
}

export function inlinePageForPosition(
  metrics: InlinePaginationMetrics,
  position: number
): number {
  const pages = inlinePageCount(metrics);
  return Math.min(
    pages - 1,
    Math.max(0, Math.round(Math.max(0, finite(position)) / inlinePageSize(metrics)))
  );
}

export function inlinePageTarget(
  metrics: InlinePaginationMetrics,
  position: number,
  direction: -1 | 1
): InlinePageTarget {
  const pages = inlinePageCount(metrics);
  const page = inlinePageForPosition(metrics, position);
  const next = page + direction;
  if (next < 0)
    return { position: 0, page, pages, moved: false, boundary: -1 };
  if (next >= pages)
    return {
      position: inlineLastPagePosition(metrics),
      page,
      pages,
      moved: false,
      boundary: 1
    };
  return {
    position: next * inlinePageSize(metrics),
    page: next,
    pages,
    moved: next !== page,
    boundary: 0
  };
}

export function inlineAnchorPosition(
  metrics: InlinePaginationMetrics,
  currentPosition: number,
  relativeOffset: number
): number {
  const absolute = Math.max(0, finite(currentPosition) + finite(relativeOffset));
  const size = inlinePageSize(metrics);
  const page = Math.floor(absolute / size);
  return Math.min(inlineLastPagePosition(metrics), Math.max(0, page * size));
}

export class FoliateInlinePaginator {
  constructor(
    private readonly scrollElement: HTMLElement,
    private readonly contentElement: HTMLElement,
    private readonly axis: InlinePaginationAxis,
    private readonly viewport: () => number,
    private readonly gap: () => number
  ) {}

  metrics(): InlinePaginationMetrics {
    return {
      viewport: Math.max(0, this.viewport()),
      extent:
        this.axis === 'vertical'
          ? this.scrollElement.scrollHeight
          : this.scrollElement.scrollWidth,
      gap: Math.max(0, this.gap())
    };
  }

  currentPosition(): number {
    if (this.axis === 'vertical') return Math.max(0, this.scrollElement.scrollTop);
    const transform = this.contentElement.style.transform.match(
      /^translateX\((-?(?:\d+(?:\.\d*)?|\.\d+))px\)$/
    );
    return transform ? Math.max(0, -Number(transform[1])) : Math.max(0, this.scrollElement.scrollLeft);
  }

  target(direction: -1 | 1, position = this.currentPosition()): InlinePageTarget {
    return inlinePageTarget(this.metrics(), position, direction);
  }

  anchor(relativeOffset: number): number {
    return inlineAnchorPosition(this.metrics(), this.currentPosition(), relativeOffset);
  }

  lastPosition(): number {
    return inlineLastPagePosition(this.metrics());
  }

  apply(position: number): number {
    const metrics = this.metrics();
    const target = Math.min(inlineLastPagePosition(metrics), Math.max(0, finite(position)));
    if (this.axis === 'vertical') {
      this.contentElement.style.removeProperty('transform');
      this.scrollElement.scrollTo({ top: target });
      return target;
    }

    const physicalMaximum = Math.max(0, metrics.extent - metrics.viewport);
    if (target <= physicalMaximum + 0.5) {
      this.contentElement.style.removeProperty('transform');
      this.scrollElement.scrollTo({ left: target });
      return target;
    }

    // The browser cannot scroll a partial final CSS column far enough to align
    // it to the viewport. Preserve Foliate-style logical page coordinates and
    // translate only that terminal remainder.
    this.scrollElement.scrollTo({ left: 0 });
    this.contentElement.style.transform = `translateX(${-target}px)`;
    return target;
  }

  reset(): void {
    this.contentElement.style.removeProperty('transform');
    if (this.axis === 'vertical') this.scrollElement.scrollTo({ top: 0 });
    else this.scrollElement.scrollTo({ left: 0 });
  }
}
