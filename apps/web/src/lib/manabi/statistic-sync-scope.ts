/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface StatisticSyncScope {
  bookKey: string;
  accountId: string;
}

const contentKey = /^content:[a-f0-9]{64}$/;

export function validStatisticSyncBookKey(value: unknown): value is string {
  return typeof value === 'string' && contentKey.test(value);
}

export function statisticSyncOwner(
  scopes: readonly StatisticSyncScope[],
  bookKey: string
): string | null | undefined {
  if (!validStatisticSyncBookKey(bookKey)) return undefined;
  const owners = new Set(
    scopes.filter((scope) => scope.bookKey === bookKey).map((scope) => scope.accountId)
  );
  return owners.size > 1 ? null : owners.values().next().value;
}

interface ScopeStore {
  get(bookKey: string): Promise<StatisticSyncScope | undefined>;
  put(value: StatisticSyncScope): Promise<unknown>;
  delete(bookKey: string): Promise<unknown>;
}

/** Claim retained statistics for personal sync without changing the statistics
 * themselves. A conflicting receipt is evidence, never permission to overwrite.
 */
export async function claimStatisticSyncScope(
  store: ScopeStore,
  bookKey: string,
  accountId: string
): Promise<void> {
  if (!validStatisticSyncBookKey(bookKey) || !accountId)
    throw new Error('The retained statistics identity is invalid.');
  const current = await store.get(bookKey);
  if (current && current.accountId !== accountId)
    throw new Error('These retained statistics belong to another account.');
  if (!current) await store.put({ bookKey, accountId });
}

export async function removeStatisticSyncScope(store: ScopeStore, bookKey: string): Promise<void> {
  if (validStatisticSyncBookKey(bookKey)) await store.delete(bookKey);
}
