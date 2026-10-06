/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { I18nManager } from 'react-native';
export function isRtlTarget(_target?: unknown) {
  return I18nManager.isRTL;
}
