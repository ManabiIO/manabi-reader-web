/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface FontChoiceOption {
  value: string;
  label: string;
}

/** Effective selection is a view of the saved preference, never a replacement
 * preference. A missing/imported family stays visible without inventing a choice. */
export function fontChoices(available: readonly string[], saved: string, effective = saved) {
  const names = [...new Set(available)];
  const options: FontChoiceOption[] = names.map((value) => ({ value, label: value }));
  if (!names.includes(effective)) {
    options.unshift({ value: effective, label: `Saved preference: ${effective || 'Default'}` });
  }
  return {
    options,
    value: effective,
    choose(next: string, disabled = false): string | null {
      // Selecting a fallback explicitly can make it a portable preference.
      // Opening a picker, receiving a stale value, or reselecting the saved font cannot.
      return !disabled && names.includes(next) && next !== saved ? next : null;
    }
  };
}
