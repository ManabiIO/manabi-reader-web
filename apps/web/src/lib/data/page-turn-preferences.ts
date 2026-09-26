/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writableStorageSubject } from './internal/writable-storage-subject';
import { localStorage } from './window/local-storage';
import { normalizePageTurnEffect } from '$lib/foliate-epub/page-turn-effect';

/** Uses the same persistence contract as the existing reader preferences. */
export const pageTurnEffect$ = writableStorageSubject(
  localStorage,
  normalizePageTurnEffect,
  normalizePageTurnEffect
)('pageTurnEffect', 'slide');
