/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type PageTurnEffect = 'slide' | 'none';

export function normalizePageTurnEffect(value: unknown): PageTurnEffect {
  return value === 'none' ? 'none' : 'slide';
}
