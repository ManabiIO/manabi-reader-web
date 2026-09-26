/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Observable, take, type Subject, type BehaviorSubject } from 'rxjs';
import {
  sectionProgress$,
  sectionList$,
  type SectionWithProgress
} from '$lib/components/book-reader/book-toc/book-toc';
import type { PageManager } from '../types';
import { FoliateInlinePaginator } from './foliate-inline-paginator';

export class PageManagerPaginated implements PageManager {
  private readonly paginator: FoliateInlinePaginator;

  private sectionData: Map<string, SectionWithProgress> = new Map();

  constructor(
    private contentEl: HTMLElement,
    private scrollEl: HTMLElement,
    private sections: Element[],
    private sectionIndex$: BehaviorSubject<number>,
    private virtualScrollPos$: BehaviorSubject<number>,
    private width: number,
    private height: number,
    private pageGap: number,
    private verticalMode: boolean,
    private pageChange$: Subject<boolean>,
    private sectionRenderComplete$: Subject<number>
  ) {
    this.paginator = new FoliateInlinePaginator(
      this.scrollEl,
      this.contentEl,
      this.verticalMode ? 'vertical' : 'horizontal',
      () => (this.verticalMode ? this.height : this.width),
      () => this.pageGap
    );

    sectionList$.pipe(take(1)).subscribe((entries) => {
      if (!entries.length) {
        return;
      }

      entries.forEach((section) => {
        this.sectionData.set(section.reference, { ...section, progress: 0 });
      });

      sectionProgress$.next(this.sectionData);
    });
  }

  nextPage() {
    this.flipPage(1);
  }

  prevPage() {
    this.flipPage(-1);
  }

  updateSectionDataByOffset(offset = 0) {
    const extent = this.verticalMode ? this.scrollEl.scrollHeight : this.scrollEl.scrollWidth;
    const current = this.paginator.currentPosition();
    const currentPercentage = (current / (extent || 1)) * 100;

    if (offset) {
      const direction = offset < 0 ? -1 : 1;
      let target = current;
      for (let index = 0; index < Math.abs(offset); index += 1) {
        const step = this.paginator.target(direction);
        if (step.boundary) break;
        target = step.position;
      }
      this.updateSectionData(
        this.sections[this.sectionIndex$.getValue()]?.id,
        (target / (extent || 1)) * 100
      );
    } else {
      this.updateSectionData(this.sections[this.sectionIndex$.getValue()]?.id, currentPercentage);
    }
  }

  flipPage(multiplier: 1 | -1) {
    const target = this.paginator.target(multiplier);
    const isUser = true;

    if (target.boundary < 0) {
      this.prevSection(isUser);
      return;
    }
    if (target.boundary > 0) {
      this.nextSection(isUser);
      return;
    }
    this.applyPosition(target.position, isUser);
  }

  scrollTo(scrollPos: number, isUser: boolean) {
    this.applyPosition(scrollPos, isUser);
  }

  private prevSection(isUser: boolean) {
    const nextPage = this.sectionIndex$.getValue() - 1;
    if (nextPage < 0) return false;

    this.updateSectionIndex(nextPage).subscribe(() => {
      const target = this.paginator.lastPosition();
      this.applyPosition(target, isUser);
    });
    return true;
  }

  private nextSection(isUser: boolean) {
    const nextPage = this.sectionIndex$.getValue() + 1;
    if (nextPage >= this.sections.length) return false;

    this.updateSectionIndex(nextPage).subscribe(() => {
      this.applyPosition(0, isUser);
      this.updateSectionData(this.sections[nextPage - 1]?.id, 100, false);
      this.updateSectionData(this.sections[nextPage]?.id, 0);
    });
    return true;
  }

  private applyPosition(pos: number, isUser: boolean) {
    const applied = this.paginator.apply(pos);
    this.virtualScrollPos$.next(applied);
    const extent = this.verticalMode ? this.scrollEl.scrollHeight : this.scrollEl.scrollWidth;
    this.updateSectionData(
      this.sections[this.sectionIndex$.getValue()]?.id,
      (applied / (extent || 1)) * 100
    );
    this.pageChange$.next(isUser);
  }

  /**
   * Updates the section index if necessary
   * @param index New section index
   * @returns An observable that emits when the section index equals to the new index
   */
  private updateSectionIndex(index: number) {
    return new Observable<void>((subscriber) => {
      if (this.sectionIndex$.getValue() === index) {
        subscriber.next();
        subscriber.complete();
        return undefined;
      }

      const subscription = this.sectionRenderComplete$.subscribe((newIndex) => {
        if (newIndex === index) {
          subscriber.next();
        }
        subscriber.complete();
        subscription.unsubscribe();
      });
      this.sectionIndex$.next(index);
      return subscription;
    });
  }

  private updateSectionData(ref: string, progress: number, emit = true) {
    if (!ref || !this.sectionData.has(ref)) return;

    const sections = [...this.sectionData.values()];
    let currentRefSeen = false;

    sections.forEach((section) => {
      const entry = this.sectionData.get(section.reference) as SectionWithProgress;
      const isCurrentRef = section.reference === ref;

      if (isCurrentRef) {
        entry.progress = progress;
      } else if (currentRefSeen) {
        entry.progress = 0;
      } else {
        entry.progress = 100;
      }

      if (!currentRefSeen && isCurrentRef) {
        currentRefSeen = true;
      }
      this.sectionData.set(section.reference, entry);
    });

    if (emit) {
      sectionProgress$.next(this.sectionData);
    }
  }
}
