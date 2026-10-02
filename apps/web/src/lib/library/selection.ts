/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Selection follows rendered tiles, not database insertion order or hidden search results. */
export interface SelectionItem<Id = number> {
  key: string;
  ids: Id[];
}
export interface SelectionModifiers {
  shift?: boolean;
  toggle?: boolean;
}
export class LibrarySelection<Id = number> {
  selected = new Set<Id>();
  anchor: string | undefined;
  focus: string | undefined;
  private rangeBase = new Set<Id>();
  private ranging = false;

  sync(ids: ReadonlySet<Id>, items: SelectionItem<Id>[]) {
    const eligible = new Set(items.flatMap((item) => item.ids));
    const next = new Set([...ids].filter((id) => eligible.has(id)));
    // A header command or a changed shelf is not another step of the old Shift gesture.
    // The component echoes our own selection too; equal echoes preserve range contraction.
    if (next.size !== this.selected.size || [...next].some((id) => !this.selected.has(id))) {
      this.ranging = false;
      this.rangeBase.clear();
    }
    this.selected = next;
    this.rangeBase = new Set([...this.rangeBase].filter((id) => eligible.has(id)));
    if (!items.some((item) => item.key === this.anchor)) this.anchor = undefined;
    if (!items.some((item) => item.key === this.focus)) this.focus = undefined;
  }
  reset() {
    this.selected.clear();
    this.anchor = this.focus = undefined;
    this.rangeBase.clear();
    this.ranging = false;
  }
  choose(key: string, items: SelectionItem<Id>[], { shift, toggle }: SelectionModifiers = {}) {
    const index = items.findIndex((item) => item.key === key);
    if (index < 0 || !items[index].ids.length) return this.selected;
    const item = items[index];
    if (shift) {
      // An existing selected tile is the anchor when Select All was invoked in the header.
      this.anchor ??=
        items.find((entry) => entry.ids.some((id) => this.selected.has(id)))?.key ?? key;
      const anchorIndex = items.findIndex((entry) => entry.key === this.anchor);
      if (!this.ranging) this.rangeBase = new Set(this.selected);
      this.selected = new Set(this.rangeBase);
      for (const entry of items.slice(
        Math.min(anchorIndex, index),
        Math.max(anchorIndex, index) + 1
      ))
        for (const id of entry.ids) this.selected.add(id);
      this.ranging = true;
    } else {
      this.selected = toggle ? new Set(this.selected) : new Set();
      const remove = toggle && item.ids.every((id) => this.selected.has(id));
      for (const id of item.ids) {
        if (remove) this.selected.delete(id);
        else this.selected.add(id);
      }
      this.anchor = key;
      this.ranging = false;
    }
    this.focus = key;
    return this.selected;
  }
  all(items: SelectionItem<Id>[]) {
    this.selected = new Set(items.flatMap((item) => item.ids));
    this.anchor = items[0]?.key;
    this.ranging = false;
    return this.selected;
  }
}

export interface LibrarySelectionEligibility {
  key: string;
  ids: readonly number[];
  previews: readonly string[];
}

export interface LibrarySelectionScope {
  viewerId: string | null;
  collectionId: string;
  seriesId?: string;
  unfinished: boolean;
  searchScope: string;
  search: string;
}

/** Ephemeral selection identity. JSON avoids delimiter collisions in user/provider text. */
export function librarySelectionScopeKey(scope: LibrarySelectionScope): string {
  return JSON.stringify([
    scope.viewerId ?? 'local',
    scope.collectionId,
    scope.seriesId ?? '',
    scope.unfinished ? 'unfinished' : 'all',
    scope.searchScope,
    scope.search
  ]);
}

export function reconcileSelectionEligibility(
  previousScope: string,
  next: LibrarySelectionEligibility,
  selectedIds: ReadonlySet<number>,
  selectedPreviews: ReadonlySet<string>
) {
  if (next.key !== previousScope)
    return {
      scope: next.key,
      ids: new Set<number>(),
      previews: new Set<string>()
    };
  const eligibleIds = new Set(next.ids);
  const eligiblePreviews = new Set(next.previews);
  return {
    scope: next.key,
    ids: new Set([...selectedIds].filter((id) => eligibleIds.has(id))),
    previews: new Set([...selectedPreviews].filter((key) => eligiblePreviews.has(key)))
  };
}

export interface SelectionRect {
  key: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
/** Up/down follow the actual responsive columns, including unequal cover dimensions. */
export function adjacentSelection(
  rects: SelectionRect[],
  current: string | undefined,
  key: string
): string | undefined {
  const index = rects.findIndex((rect) => rect.key === current);
  if (key === 'Home') return rects[0]?.key;
  if (key === 'End') return rects.at(-1)?.key;
  if (index < 0) return rects[0]?.key;
  if (key === 'ArrowLeft') return rects[Math.max(0, index - 1)]?.key;
  if (key === 'ArrowRight') return rects[Math.min(rects.length - 1, index + 1)]?.key;
  const origin = rects[index],
    direction = key === 'ArrowUp' ? -1 : 1;
  const x = (origin.left + origin.right) / 2;
  // Tile tops form rows even when the button height differs with title wrapping.
  const candidates = rects.filter((rect) => direction * (rect.top - origin.top) > 4);
  const nearestRow = Math.min(...candidates.map((rect) => Math.abs(rect.top - origin.top)));
  return (
    candidates
      .filter((rect) => Math.abs(rect.top - origin.top) <= nearestRow + 4)
      .sort(
        (a, b) => Math.abs((a.left + a.right) / 2 - x) - Math.abs((b.left + b.right) / 2 - x)
      )[0]?.key ?? current
  );
}
export function marqueeSelection<Id>(
  items: SelectionItem<Id>[],
  hits: ReadonlySet<string>,
  baseline: ReadonlySet<Id>,
  modifiers: SelectionModifiers
): Set<Id> {
  const selected = new Set(modifiers.shift || modifiers.toggle ? baseline : []);
  for (const item of items) {
    if (!hits.has(item.key)) continue;
    const remove = modifiers.toggle && item.ids.every((id) => baseline.has(id));
    for (const id of item.ids) {
      if (remove) selected.delete(id);
      else selected.add(id);
    }
  }
  return selected;
}
