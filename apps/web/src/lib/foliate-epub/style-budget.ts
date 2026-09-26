/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Bound generated CSS before retaining each expanded selector/rule. */
export class EpubStyleBudget {
  private size = 0;
  private parts: string[] = [];

  append(value: string): void {
    const next = this.size + value.length + (this.parts.length ? 1 : 0);
    if (next > 4 * 1024 * 1024)
      throw new Error('EPUB compatibility styles exceed the expanded size limit.');
    this.size = next;
    this.parts.push(value);
  }

  toString(): string {
    return this.parts.join('\n');
  }
}
