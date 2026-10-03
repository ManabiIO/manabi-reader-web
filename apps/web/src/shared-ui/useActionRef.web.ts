/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useCallback, type ForwardedRef } from 'react';
import type { View } from 'react-native';
/** RNW 0.21 filters title on View; keep this DOM attribute at the primitive leaf. */
export function useActionRef(ref: ForwardedRef<View>, title?: string) {
  return useCallback(
    (view: View | null) => {
      const element = view as unknown as HTMLElement | null;
      if (title) element?.setAttribute('title', title);
      else element?.removeAttribute('title');
      if (typeof ref === 'function') ref(view);
      else if (ref) ref.current = view;
    },
    [ref, title]
  );
}
