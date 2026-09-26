/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EpubStyleBudget } from '../../apps/web/src/lib/foliate-epub/style-budget.ts';

test('expanded stylesheet budget includes separators and all resource groups', () => {
  const budget = new EpubStyleBudget();
  const chunk = 'x'.repeat(2 * 1024 * 1024 - 1);
  budget.append(chunk);
  budget.append(chunk);
  assert.equal(budget.toString().length, 4 * 1024 * 1024 - 1);
  assert.throws(() => budget.append('x'), /expanded size limit/);
  assert.equal(budget.toString().length, 4 * 1024 * 1024 - 1);
});

test('oversized first expansion is rejected without retaining it', () => {
  const budget = new EpubStyleBudget();
  assert.throws(() => budget.append('x'.repeat(4 * 1024 * 1024 + 1)), /expanded size limit/);
  budget.append('p{color:red}');
  assert.equal(budget.toString(), 'p{color:red}');
});
