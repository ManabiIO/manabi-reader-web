/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type PageTurnEffect = 'slide' | 'none';

export const pageTurnEffectOptions = [
  { value: 'slide', label: 'Slide' },
  { value: 'none', label: 'None' }
] as const;

export function normalizePageTurnEffect(value: unknown): PageTurnEffect {
  return value === 'none' ? 'none' : 'slide';
}
