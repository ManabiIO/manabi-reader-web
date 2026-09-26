/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Initial focus is a fallback, not permission to move focus away from a field
 * the user already reached while the modal was opening. Keep Bits UI's default
 * when focus is outside (or only on the container), and honor explicit callers.
 */
export function preserveModalFocus(
  event: Event,
  content: HTMLElement | null,
  onOpenAutoFocus?: (event: Event) => void
): void {
  onOpenAutoFocus?.(event);
  if (event.defaultPrevented || !content?.isConnected) return;
  const active = content.ownerDocument.activeElement;
  if (active && active !== content && content.contains(active)) event.preventDefault();
}
