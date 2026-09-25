/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export type SyncPayload = Record<string, unknown> | null;

/** Match the JSON value the server actually receives, including omitted optional fields. */
export function wirePayload(value: SyncPayload): SyncPayload {
  return value === null ? null : (JSON.parse(JSON.stringify(value)) as Record<string, unknown>);
}

/** A feed item can stand in for a lost HTTP acknowledgement only for this exact request. */
export function matchesAcknowledgedFeed(
  request:
    | {
        kind: string;
        entity_id: string;
        book_key: string;
        base_revision: number;
        operation: string;
        payload: SyncPayload;
      }
    | undefined,
  record: {
    kind: string;
    entity_id: string;
    book_key: string | null;
    revision: number;
    deleted: boolean;
    payload: SyncPayload;
  }
): boolean {
  return (
    !!request &&
    request.kind === record.kind &&
    request.entity_id === record.entity_id &&
    request.book_key === record.book_key &&
    request.base_revision + 1 === record.revision &&
    (request.operation === 'delete') === record.deleted &&
    samePayload(wirePayload(request.payload), record.payload)
  );
}

export function samePayload(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => samePayload(value, right[index]))
    );
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && samePayload(a[key], b[key]))
  );
}

export function mergePayload(
  base: SyncPayload,
  local: SyncPayload,
  remote: SyncPayload
): { value: SyncPayload; fields: string[] } {
  if (samePayload(local, remote) || samePayload(remote, base)) return { value: local, fields: [] };
  if (samePayload(local, base)) return { value: remote, fields: [] };
  if (remote === null || local === null) return { value: local, fields: ['deleted'] };
  const value: Record<string, unknown> = {};
  const fields: string[] = [];
  for (const field of new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(local),
    ...Object.keys(remote)
  ])) {
    const before = base?.[field],
      here = local[field],
      there = remote[field];
    const next =
      samePayload(here, there) || samePayload(there, before)
        ? here
        : samePayload(here, before)
          ? there
          : (fields.push(field), here);
    if (next !== undefined) value[field] = next;
  }
  return { value, fields };
}

export function mergeAnnotationPayload(
  base: SyncPayload,
  local: SyncPayload,
  remote: SyncPayload,
  now: string
): { value: SyncPayload; fields: string[] } {
  if (samePayload(local, remote) || samePayload(remote, base)) return { value: local, fields: [] };
  if (samePayload(local, base)) return { value: remote, fields: [] };
  if (!local || !remote) return { value: local, fields: ['deleted'] };
  const portable = ['kind', 'targets', 'body', 'label', 'color', 'decoration'];
  const subset = (source: SyncPayload) =>
    Object.fromEntries(
      portable
        .filter((field) => source && source[field] !== undefined)
        .map((field) => [field, source![field]])
    );
  const merged = mergePayload(subset(base), subset(local), subset(remote));
  // Mergeable optional fields must be rebuilt, not spread over an older entity.
  // Otherwise an omitted field (for example a remotely deleted note body) is
  // immediately resurrected by `...local`/`...remote`. Preserve immutable
  // identity/timestamps from the entities, remove the mergeable surface, then
  // apply only the fields selected by the three-way merge.
  const value: Record<string, unknown> = { ...remote, ...local };
  for (const field of portable) delete value[field];
  Object.assign(value, merged.value ?? {});
  value.revision = Math.max(Number(local.revision) || 0, Number(remote.revision) || 0) + 1;
  value.modifiedAt = now;
  return { value, fields: merged.fields };
}
