/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ForwardedRef } from 'react';
import type { View } from 'react-native';
export function useActionRef(ref: ForwardedRef<View>, _title?: string) {
  return ref;
}
