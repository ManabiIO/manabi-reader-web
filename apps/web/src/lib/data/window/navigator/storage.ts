/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { browser } from '$app/environment';

import { createStorageAccess } from './storage-access.mjs';

export const storage = createStorageAccess(() => (browser ? navigator.storage : undefined));
