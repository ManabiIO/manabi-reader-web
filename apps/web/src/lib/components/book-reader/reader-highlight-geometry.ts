/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface ReaderRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ReaderHighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function translated(rect: ReaderRect, left: number, top: number): ReaderRect {
  return {
    left: rect.left + left,
    top: rect.top + top,
    right: rect.right + left,
    bottom: rect.bottom + top
  };
}

/**
 * Convert a range rectangle into top-level viewport coordinates and clip it to
 * every surface that can hide the glyphs. This prevents framed/offscreen text
 * from painting fixed-position highlights over adjacent pages or reader UI.
 */
export function clipReaderHighlightRect(
  rect: ReaderRect,
  options: {
    offsetLeft?: number;
    offsetTop?: number;
    localClip?: ReaderRect;
    outerClip?: ReaderRect;
    viewportWidth: number;
    viewportHeight: number;
  }
): ReaderHighlightBox | undefined {
  const offsetLeft = options.offsetLeft ?? 0;
  const offsetTop = options.offsetTop ?? 0;
  const source = translated(rect, offsetLeft, offsetTop);
  let left = Math.max(0, source.left);
  let top = Math.max(0, source.top);
  let right = Math.min(options.viewportWidth, source.right);
  let bottom = Math.min(options.viewportHeight, source.bottom);

  const clips: ReaderRect[] = [];
  if (options.localClip) clips.push(translated(options.localClip, offsetLeft, offsetTop));
  if (options.outerClip) clips.push(options.outerClip);
  for (const clip of clips) {
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }

  const width = right - left;
  const height = bottom - top;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    return undefined;
  return { left, top, width, height };
}
