/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readerName } from '../../runtime/edition';

export function formatPageTitle(title: string) {
  const appName = readerName;
  if (!title) return appName;
  return `${title} | ${appName}`;
}
