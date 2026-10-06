/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef } from 'react';
import type { ShortcutListenerProps } from './ShortcutListener';
export function ShortcutListener<T extends string>(props: ShortcutListenerProps<T>) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const { enabled, bindings, onShortcut } = latest.current;
      if (
        !enabled ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input,textarea,select,[contenteditable="true"],dialog,[role="dialog"],.heatmap-calendar'
        )
      )
        return;
      const action = bindings[event.code || event.key?.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      onShortcut(action);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
    window.addEventListener('keyup', listener);
    return () => window.removeEventListener('keyup', listener);
  }, []);
  return null;
}
