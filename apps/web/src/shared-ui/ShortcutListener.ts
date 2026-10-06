/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface ShortcutListenerProps<T extends string> {
  enabled: boolean;
  bindings: Record<string, T>;
  onShortcut(action: T): void;
}
/** Touch controls remain available on Android; window keyup is a browser input capability. */
export function ShortcutListener<T extends string>(_props: ShortcutListenerProps<T>) {
  return null;
}
