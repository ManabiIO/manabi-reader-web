/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { backTo } from '../runtime/navigation';

/** Keep modified link gestures native; ordinary Back pops the admitted visit. */
export function handleRouteBack(
  event: Pick<
    MouseEvent,
    'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'
  >,
  href: string
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey
  )
    return;
  event.preventDefault();
  void backTo(href);
}
