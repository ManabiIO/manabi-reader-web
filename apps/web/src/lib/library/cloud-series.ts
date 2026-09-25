/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { currentUser, request } from '$lib/manabi/client';
import { integrationDB, metadata, setMetadata } from '$lib/manabi/persistence';
import { sourceKey } from './organization';
import type { SourceDescriptor } from './catalog';

export type CloudSeriesOperation = 'create_series' | 'move_books' | 'rename_series';
export interface CloudSeriesCapability {
  provider: string;
  root: string;
  operations: CloudSeriesOperation[];
  can_edit: boolean;
  reasons: string[];
  item_permission: 'checked_at_execute';
  concurrency: 'onedrive_if_match' | 'unavailable';
  scope_upgrade: 'Files.ReadWrite' | null;
}
export interface CloudSeriesReceipt {
  connection_id: string;
  root: string;
  item_id?: string;
  old_parent?: string;
  new_parent?: string;
  name: string;
  folder_id?: string;
  old_marker?: string;
}
export interface CloudSeriesPlan {
  id: string;
  root: string;
  operation: CloudSeriesOperation;
  revision: number;
  status:
    | 'preparing'
    | 'prepared'
    | 'queued'
    | 'running'
    | 'reconcile'
    | 'paused'
    | 'complete'
    | 'cancelled';
  preparation?: { completed_books: number; total_books: number };
  issue: string;
  expires_at: string;
  preview: {
    folder_name: string | null;
    name: string | null;
    book_names: string[];
    parent_id: string | null;
    destination_id: string | null;
  };
  steps: { action: string; item_id?: string; state: 'pending' | 'claimed' | 'done' }[];
  receipts: CloudSeriesReceipt[];
}
export type CloudSeriesRequest =
  | {
      operation: 'create_series';
      root: string;
      parent_id: string;
      folder_name: string;
      name: string;
      book_ids: string[];
    }
  | { operation: 'move_books'; root: string; destination_id: string; book_ids: string[] }
  | { operation: 'rename_series'; root: string; folder_id: string; name: string };

function cloudSource(source: SourceDescriptor) {
  if (!source.owner || source.owner !== currentUser()?.id || !/^[0-9a-f-]{36}$/i.test(source.id))
    throw new Error('This cloud source belongs to another account or is disconnected.');
  return source.owner;
}
function base(source: SourceDescriptor) {
  return `connections/${source.id}/series/`;
}
function planId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid series plan ID');
  return id;
}
function currentKey(source: SourceDescriptor, owner: string) {
  return `cloud-series-current:${owner}:${source.id}:${source.root}`;
}
export async function cloudSeriesCapabilities(source: SourceDescriptor) {
  const owner = cloudSource(source);
  return request<CloudSeriesCapability>(
    `${base(source)}capabilities/?${new URLSearchParams({ root: source.root })}`,
    { userId: owner }
  );
}
/** Admit read-only preparation. Poll until prepared before presenting a final preview. */
export async function prepareCloudSeries(source: SourceDescriptor, value: CloudSeriesRequest) {
  const owner = cloudSource(source);
  if (value.root !== source.root) throw new Error('Series plan must remain in its selected root.');
  const plan = await request<CloudSeriesPlan>(`${base(source)}plans/`, {
    method: 'POST',
    value,
    userId: owner
  });
  await setMetadata(currentKey(source, owner), plan.id);
  return plan;
}
export async function pendingCloudSeries(source: SourceDescriptor) {
  const owner = cloudSource(source);
  const id = await metadata<string>(currentKey(source, owner));
  return id ? cloudSeriesStatus(source, id) : undefined;
}
export async function recentCloudSeries(source: SourceDescriptor) {
  const owner = cloudSource(source);
  const result = await request<{ items: CloudSeriesPlan[] }>(
    `${base(source)}plans/?${new URLSearchParams({ root: source.root })}`,
    { userId: owner }
  );
  for (const plan of result.items) await applyCloudSeriesReceipts(source, plan);
  return result.items;
}
export async function cloudSeriesStatus(source: SourceDescriptor, id: string) {
  const plan = await request<CloudSeriesPlan>(`${base(source)}plans/${planId(id)}/`, {
    userId: cloudSource(source)
  });
  await applyCloudSeriesReceipts(source, plan);
  return plan;
}
export async function cancelCloudSeries(source: SourceDescriptor, id: string) {
  const plan = await request<CloudSeriesPlan>(`${base(source)}plans/${planId(id)}/cancel/`, {
    method: 'POST',
    value: {},
    userId: cloudSource(source)
  });
  await applyCloudSeriesReceipts(source, plan);
  return plan;
}

/** Confirm once; the bounded server worker continues independently of this browser. */
export async function advanceCloudSeries(source: SourceDescriptor, plan: CloudSeriesPlan) {
  const owner = cloudSource(source);
  if (plan.root !== source.root) throw new Error('Plan root changed.');
  const id = planId(plan.id);
  const keyName = `cloud-series-operation:${owner}:${source.id}:${id}`;
  let key = await metadata<string>(keyName);
  if (!key) {
    key = crypto.randomUUID();
    await setMetadata(keyName, key);
  }
  const result = await request<CloudSeriesPlan>(`${base(source)}plans/${id}/execute/`, {
    method: 'POST',
    value: { revision: plan.revision, idempotency_key: key },
    userId: owner
  });
  await applyCloudSeriesReceipts(source, result);
  return result;
}

/** Stable provider IDs mean book links keep their IDs; only folder listings need invalidation. */
export async function applyCloudSeriesReceipts(source: SourceDescriptor, plan: CloudSeriesPlan) {
  const owner = cloudSource(source);
  if (plan.root !== source.root) throw new Error('Receipt root changed.');
  const db = await integrationDB();
  const tx = db.transaction('metadata', 'readwrite');
  try {
    let changed = false;
    for (const receipt of plan.receipts) {
      if (receipt.connection_id !== source.id || receipt.root !== source.root)
        throw new Error('Receipt source changed.');
      const key = `cloud-series-receipt:${owner}:${source.id}:${plan.id}:${receipt.item_id || receipt.folder_id}`;
      if (!(await tx.store.get(key))) {
        await tx.store.put(receipt, key);
        changed = true;
      }
    }
    if (changed) await tx.store.delete(`library-catalog:${sourceKey(source)}`);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already settled */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
