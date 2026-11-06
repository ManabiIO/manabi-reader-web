/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentRef, ForwardedRef } from 'react';
import type { View } from 'react-native';
export function useActionRef(ref: ForwardedRef<ComponentRef<typeof View>>, _title?: string) {
  return ref;
}
