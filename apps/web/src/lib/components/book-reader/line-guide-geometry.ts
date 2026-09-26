/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface LineRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface MeasuredLine {
  rect: LineRect;
  vertical: boolean;
}

function axes({ rect, vertical }: MeasuredLine) {
  return vertical
    ? { start: rect.left, end: rect.right, inlineStart: rect.top, inlineEnd: rect.bottom }
    : { start: rect.top, end: rect.bottom, inlineStart: rect.left, inlineEnd: rect.right };
}

function union(a: LineRect, b: LineRect): LineRect {
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom)
  };
}

/** Keep DOM reading order, joining adjacent inline runs but never distant columns. */
export function groupLineRects(candidates: readonly MeasuredLine[]): MeasuredLine[] {
  const lines: MeasuredLine[] = [];
  for (const candidate of candidates) {
    const b = axes(candidate);
    const matches = lines.filter((line) => {
      if (line.vertical !== candidate.vertical) return false;
      const a = axes(line);
      const thickness = Math.min(a.end - a.start, b.end - b.start);
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      const gap = Math.max(a.inlineStart, b.inlineStart) - Math.min(a.inlineEnd, b.inlineEnd);
      return overlap >= thickness * 0.35 && gap <= thickness;
    });
    if (!matches.length)
      lines.push({ rect: union(candidate.rect, candidate.rect), vertical: candidate.vertical });
    else {
      const first = matches[0];
      first.rect = union(first.rect, candidate.rect);
      for (const other of matches.slice(1)) {
        first.rect = union(first.rect, other.rect);
        lines.splice(lines.indexOf(other), 1);
      }
    }
  }
  return lines;
}

/** Expanding the aperture must stop at a column/page boundary. */
export function visibleLineRects(lines: readonly MeasuredLine[], active: number, count: number) {
  const current = lines[active];
  if (!current) return [];
  const a = axes(current);
  const half = Math.floor(count / 2);
  return lines
    .slice(Math.max(0, active - half), active + half + 1)
    .filter((line) => {
      if (line.vertical !== current.vertical) return false;
      const b = axes(line);
      const inlineOverlap =
        Math.min(a.inlineEnd, b.inlineEnd) - Math.max(a.inlineStart, b.inlineStart);
      const distance = Math.max(a.start, b.start) - Math.min(a.end, b.end);
      return inlineOverlap > 0 && distance <= Math.max(a.end - a.start, b.end - b.start) * 3;
    })
    .map((line) => line.rect);
}
