/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { canonical, digestText } from './hash.js';
import {
  record,
  onlyKeys,
  isContentKey,
  isDigest,
  isUUID,
  validatePlayback,
  validateInfo,
  validateTrack,
  validateCue,
  type Scope,
  type ContentKey,
  type Track
} from './contracts.js';
export type Kind = 'video_info' | 'video_resume' | 'video_track' | 'video_chunk';
export type Payload = Record<string, unknown> | null;
export interface Remote {
  kind: Kind;
  entity_id: string;
  book_key: ContentKey;
  revision: number;
  payload: Payload;
  deleted: boolean;
  sequence?: number;
}
export interface Mutation {
  mutation_id: string;
  kind: Kind;
  entity_id: string;
  book_key: ContentKey;
  base_revision: number;
  operation: 'put' | 'delete';
  payload: Payload;
}
export interface Replica {
  scope: Scope;
  kind: Kind;
  id: string;
  mediaKey: ContentKey;
  payload: Payload;
  base: Payload;
  revision: number;
  localVersion: string;
  dirty: boolean;
  pending?: {
    version: string;
    request: Mutation;
  };
  conflict?: Remote;
}
export const kinds: readonly Kind[] = ['video_info', 'video_resume', 'video_track', 'video_chunk'];
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function validatePayload(kind: Kind, id: string, key: ContentKey, value: Payload) {
  if (!kinds.includes(kind) || !isContentKey(key) || typeof id !== 'string' || id.length > 160)
    throw new Error('Invalid media record identity');
  if ((kind === 'video_info' || kind === 'video_resume') && id !== key)
    throw new Error('Wrong content identity');
  if (kind === 'video_track' && !isUUID(id)) throw new Error('Invalid track identity');
  if (kind === 'video_chunk') {
    const [track, marker, index, ...extra] = id.split('/');
    if (
      !isUUID(track) ||
      marker !== 'p' ||
      extra.length ||
      !/^(?:0|[1-9][0-9]{0,3})$/.test(index) ||
      +index > 1023
    )
      throw new Error('Invalid caption page identity');
  }
  if (value === null) return;
  if (new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024)
    throw new Error('Media record exceeds 256 KiB');
  if (kind === 'video_info') validateInfo(value);
  if (kind === 'video_resume' && validatePlayback(value).mediaKey !== key)
    throw new Error('Wrong content identity');
  if (kind === 'video_track') {
    onlyKeys(value, ['version', 'track', 'pages', 'count', 'digest']);
    const t = validateTrack({ ...record(value.track), cues: [] });
    if (
      value.version !== 1 ||
      t.id !== id ||
      t.mediaKey !== key ||
      !t.complete ||
      !Array.isArray(value.pages) ||
      value.pages.length > 1024 ||
      !Number.isInteger(value.count) ||
      (value.count as number) < 0 ||
      (value.count as number) > 50000 ||
      !isDigest(value.digest)
    )
      throw new Error('Invalid track manifest');
    if (
      (value.count === 0) !== (value.pages.length === 0) ||
      (value.count as number) < value.pages.length ||
      (value.count as number) > value.pages.length * 200
    )
      throw new Error('Inconsistent track page count');
    for (const [i, page] of value.pages.entries()) {
      const p = record(page);
      onlyKeys(p, ['id', 'digest']);
      if (p.id !== `${id}/p/${i}` || !isDigest(p.digest)) throw new Error('Invalid manifest page');
    }
  }
  if (kind === 'video_chunk') {
    onlyKeys(value, ['version', 'trackId', 'index', 'cues']);
    if (
      value.version !== 1 ||
      !isUUID(value.trackId) ||
      !Number.isInteger(value.index) ||
      (value.index as number) < 0 ||
      id !== `${value.trackId}/p/${value.index}` ||
      !Array.isArray(value.cues) ||
      !value.cues.length ||
      value.cues.length > 200
    )
      throw new Error('Invalid caption page');
    value.cues.forEach(validateCue);
    if (new Set(value.cues.map((c) => (c as { id: string }).id)).size !== value.cues.length)
      throw new Error('Duplicate caption page cue');
  }
}
export function remote(value: unknown): Remote {
  const r = record(value),
    kind = r.kind as Kind,
    id = r.entity_id,
    key = r.book_key as ContentKey;
  if (typeof id !== 'string') throw new Error('Invalid remote media identity');
  if (
    !Number.isSafeInteger(r.revision) ||
    (r.revision as number) < 1 ||
    typeof r.deleted !== 'boolean' ||
    r.deleted !== (r.payload === null)
  )
    throw new Error('Invalid remote media record');
  const payload = r.payload === null ? null : record(r.payload);
  validatePayload(kind, id, key, payload);
  return {
    kind,
    entity_id: id,
    book_key: key,
    revision: r.revision as number,
    payload: structuredClone(payload),
    deleted: r.deleted,
    ...(typeof r.sequence === 'number' ? { sequence: r.sequence } : {})
  };
}
export function edit(
  old: Replica | undefined,
  scope: Scope,
  kind: Kind,
  id: string,
  key: ContentKey,
  payload: Payload,
  version: string
): Replica {
  validatePayload(kind, id, key, payload);
  if (old && (old.scope !== scope || old.kind !== kind || old.id !== id || old.mediaKey !== key))
    throw new Error('Media record identity changed');
  return {
    scope,
    kind,
    id,
    mediaKey: key,
    base: old?.base ?? null,
    revision: old?.revision ?? 0,
    localVersion: version,
    dirty: true,
    payload: structuredClone(payload),
    ...(old?.pending ? { pending: old.pending } : {}),
    ...(old?.conflict ? { conflict: old.conflict } : {})
  };
}
export function prepare(r: Replica, id: string): Replica {
  if (r.pending || !r.dirty || r.conflict) return r;
  return {
    ...r,
    pending: {
      version: r.localVersion,
      request: {
        mutation_id: id,
        kind: r.kind,
        entity_id: r.id,
        book_key: r.mediaKey,
        base_revision: r.revision,
        operation: r.payload === null ? 'delete' : 'put',
        payload: structuredClone(r.payload)
      }
    }
  };
}
export function acknowledge(r: Replica, id: string, accepted: Remote): Replica {
  if (!r.pending || r.pending.request.mutation_id !== id) return r;
  if (
    accepted.kind !== r.kind ||
    accepted.entity_id !== r.id ||
    accepted.book_key !== r.mediaKey ||
    accepted.revision !== r.pending.request.base_revision + 1 ||
    !same(accepted.payload, r.pending.request.payload)
  )
    throw new Error('Invalid media acknowledgement');
  const newer = r.localVersion !== r.pending.version;
  const next = {
    ...r,
    base: accepted.payload,
    revision: accepted.revision,
    payload: newer ? r.payload : accepted.payload,
    dirty: newer,
    pending: undefined,
    conflict: undefined
  };
  // Another tab/feed may have observed a successor while this request was in flight.
  // Its cursor is already advanced; clearing that evidence loses the update forever.
  if (r.conflict && r.conflict.revision > accepted.revision)
    return ingest(next, r.scope, r.conflict);
  if (r.conflict?.revision === accepted.revision && !same(r.conflict.payload, accepted.payload))
    throw new Error('Contradictory media revision');
  return next;
}
export function ingest(r: Replica | undefined, scope: Scope, server: Remote): Replica {
  if (
    r &&
    (r.scope !== scope ||
      r.kind !== server.kind ||
      r.id !== server.entity_id ||
      r.mediaKey !== server.book_key)
  )
    throw new Error('Wrong media ingestion identity');
  if (r && server.revision <= Math.max(r.revision, r.conflict?.revision ?? 0)) return r;
  if (
    r?.pending &&
    server.revision === r.pending.request.base_revision + 1 &&
    same(server.payload, r.pending.request.payload)
  )
    return acknowledge(r, r.pending.request.mutation_id, server);
  if (r?.pending || (r?.dirty && !same(r.payload, server.payload)))
    return { ...r, conflict: server };
  return {
    scope,
    kind: server.kind,
    id: server.entity_id,
    mediaKey: server.book_key,
    payload: server.payload,
    base: server.payload,
    revision: server.revision,
    localVersion: crypto.randomUUID(),
    dirty: false
  };
}
export function resolve(r: Replica, choice: 'local' | 'remote'): Replica {
  if (!r.conflict) throw new Error('There is no sync conflict');
  return {
    ...r,
    payload: choice === 'local' ? r.payload : r.conflict.payload,
    base: r.conflict.payload,
    revision: r.conflict.revision,
    dirty: choice === 'local',
    localVersion: crypto.randomUUID(),
    pending: undefined,
    conflict: undefined
  };
}
export function splitTrack(input: Track): {
  kind: Kind;
  id: string;
  key: ContentKey;
  payload: Record<string, unknown>;
}[] {
  const track = validateTrack(input);
  if (!track.complete) throw new Error('Partial transcripts cannot be published');
  const groups: (typeof track.cues)[] = [];
  let group: typeof track.cues = [];
  for (const cue of track.cues) {
    if (
      group.length &&
      (group.length >= 200 ||
        new TextEncoder().encode(JSON.stringify([...group, cue])).length > 180 * 1024)
    ) {
      groups.push(group);
      group = [];
    }
    group.push(cue);
  }
  if (group.length) groups.push(group);
  const pages = groups.map((cues, i) => ({
    id: `${track.id}/p/${i}`,
    digest: digestText(canonical(cues))
  }));
  const output = groups.map((cues, index) => ({
    kind: 'video_chunk' as Kind,
    id: pages[index].id,
    key: track.mediaKey,
    payload: { version: 1, trackId: track.id, index, cues } as Record<string, unknown>
  }));
  const { cues, ...metadata } = track;
  output.push({
    kind: 'video_track',
    id: track.id,
    key: track.mediaKey,
    payload: {
      version: 1,
      track: metadata,
      pages,
      count: cues.length,
      digest: digestText(canonical(cues))
    }
  });
  return output;
}
export function assembleTrack(manifest: Replica, all: readonly Replica[]): Track | undefined {
  if (manifest.kind !== 'video_track' || !manifest.payload) return undefined;
  const p = manifest.payload;
  validatePayload(manifest.kind, manifest.id, manifest.mediaKey, p);
  const byId = new Map(
    all
      .filter(
        (r) =>
          r.kind === 'video_chunk' && r.scope === manifest.scope && r.mediaKey === manifest.mediaKey
      )
      .map((r) => [r.id, r])
  );
  const cues: unknown[] = [];
  for (const page of p.pages as {
    id: string;
    digest: string;
  }[]) {
    const c = byId.get(page.id)?.payload?.cues;
    if (!Array.isArray(c) || digestText(canonical(c)) !== page.digest) return undefined;
    cues.push(...c);
  }
  if (cues.length !== p.count || digestText(canonical(cues)) !== p.digest) return undefined;
  return validateTrack({ ...(p.track as object), cues });
}
