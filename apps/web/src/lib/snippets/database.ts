/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { summarize, type SnippetSummary } from './summary';
import { integrationDB, equal } from '../manabi/persistence';
import type { SourceDescriptor } from '../library/catalog';
import {
  canonical,
  retainRemoteAncestor,
  encodeSnippet,
  parseSnippet,
  SnippetError,
  type SnippetDocument,
  type SnippetLocator
} from './document';

export interface Destination {
  source: SourceDescriptor;
  parent: string;
  name?: string;
  createId?: string;
}
export interface Location extends Destination {
  fileId: string;
  name: string;
  token: string;
  observedRevision?: string;
  missing?: boolean;
}
export interface SnippetRecord {
  key: string;
  owner: string;
  document: SnippetDocument;
  destination?: Destination;
  locations: Location[];
  /** One primary home; other discovered copies never become automatic writable replicas. */
  primary?: string;
  remoteRevision?: string;
  dirty: boolean;
  upload?: { document: SnippetDocument; destination: Destination; expected?: Location };
  conflicts: SnippetDocument[];
  issue?: string;
  progress?: SnippetLocator;
  progressToken?: string;
  readAt?: number;
  progressDirty?: boolean;
  stateCheckedAt?: number;
  transfer?: string;
}
export interface SnippetDraft {
  key: string;
  owner: string;
  id: string;
  session: string;
  base: string | null;
  document: SnippetDocument;
  destination?: Destination;
  updatedAt: number;
  mode?: 'new' | 'edit' | 'append';
  locationChosen?: boolean;
  operation?: string;
}
export interface SnippetTransfer {
  key: string;
  owner: string;
  id: string;
  snippetId: string;
  document: SnippetDocument;
  from?: Location;
  to: Destination;
  phase: 'prepared' | 'copied' | 'complete';
  copied?: Location;
  /** Persisted before the first provider mutation; cancellation cannot guess after a lost reply. */
  attempted?: boolean;
  native?: boolean;
  issue?: string;
}
export type Guard = () => void;
export const recordKey = (owner: string, id: string) => JSON.stringify([owner, id]);
export const locationKey = (location: Location) =>
  JSON.stringify([
    location.source.owner,
    location.source.id,
    location.source.root,
    location.fileId
  ]);
export const changed = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('manabi-snippets-changed'));
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('manabi-snippets');
      channel.postMessage('changed');
      channel.close();
    } catch {
      /* A committed save must not fail because notifications are unavailable. */
    }
  }
};
export async function summaries(owner: string): Promise<SnippetSummary[]> {
  return (await integrationDB()).getAllFromIndex('snippetSummaries', 'owner', owner);
}
export async function records(owner: string): Promise<SnippetRecord[]> {
  return (await integrationDB()).getAllFromIndex('snippets', 'owner', owner);
}
export async function getRecord(owner: string, id: string): Promise<SnippetRecord | undefined> {
  return (await integrationDB()).get('snippets', recordKey(owner, id));
}
/** Every write rechecks the expected revision in the same cross-tab IndexedDB transaction. */
export async function mutateRecord(
  owner: string,
  id: string,
  guard: Guard,
  change: (current: SnippetRecord | undefined) => SnippetRecord | undefined
) {
  guard();
  const db = await integrationDB(),
    tx = db.transaction(['snippets', 'snippetSummaries'], 'readwrite');
  try {
    const current = await tx.objectStore('snippets').get(recordKey(owner, id));
    guard();
    const next = change(current);
    const modified = !!next && !equal(current, next);
    if (next && modified) {
      if (next.owner !== owner || next.key !== recordKey(owner, id) || next.document.id !== id)
        throw new Error('Snippet ownership changed.');
      parseSnippet(encodeSnippet(next.document));
      await tx.objectStore('snippets').put(next);
      await tx.objectStore('snippetSummaries').put(summarize(next));
    }
    await tx.done;
    if (modified) changed();
    return next;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function saveDocument(
  owner: string,
  document: SnippetDocument,
  base: string | null,
  destination: Destination | undefined,
  guard: Guard
) {
  return mutateRecord(owner, document.id, guard, (current) => {
    if ((current?.document.revision ?? null) !== base)
      throw new SnippetError(
        'conflict',
        'This snippet changed in another tab. Your draft is kept; reopen the newer version or save this draft as a copy.'
      );
    if (current?.transfer)
      throw new SnippetError('busy', 'Finish or cancel the pending move before editing.');
    document = retainRemoteAncestor(document, current?.remoteRevision);
    if (current && current.conflicts.length)
      throw new SnippetError(
        'conflict',
        'Resolve the conflicting version before editing this snippet.'
      );
    return {
      ...current,
      key: recordKey(owner, document.id),
      owner,
      document,
      // New documents must never inherit a provider file/create ID or filename
      // from a copied draft. Those locators belong to the original document.
      destination:
        current?.destination ??
        (destination ? { source: destination.source, parent: destination.parent } : undefined),
      locations: current?.locations ?? [],
      conflicts: [],
      dirty: !!(current?.destination ?? destination),
      issue: undefined
    };
  });
}
export async function saveDraft(draft: SnippetDraft, guard: Guard) {
  guard();
  if (draft.key !== recordKey(draft.owner, draft.session) || draft.id !== draft.document.id)
    throw new Error('Invalid draft identity.');
  parseSnippet(encodeSnippet(draft.document));
  const db = await integrationDB(),
    tx = db.transaction('snippetDrafts', 'readwrite');
  try {
    const previous = await tx.store.get(draft.key);
    guard();
    if (!previous || previous.updatedAt <= draft.updatedAt) await tx.store.put(draft);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* settled */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function drafts(owner: string) {
  return (await integrationDB()).getAllFromIndex('snippetDrafts', 'owner', owner);
}
export async function deleteDraft(key: string, guard: Guard) {
  guard();
  const db = await integrationDB();
  guard();
  await db.delete('snippetDrafts', key);
  changed();
}
export async function acceptRemote(
  owner: string,
  document: SnippetDocument,
  location: Location,
  guard: Guard
) {
  location = { ...location, observedRevision: document.revision, missing: false };
  return mutateRecord(owner, document.id, guard, (current) => {
    if (!current)
      return {
        key: recordKey(owner, document.id),
        owner,
        document,
        destination: location,
        locations: [location],
        primary: locationKey(location),
        remoteRevision: document.revision,
        dirty: false,
        conflicts: []
      };
    const key = locationKey(location),
      locations = [...current.locations.filter((item) => locationKey(item) !== key), location];
    const previous = current.locations.find((item) => locationKey(item) === current.primary);
    const primaryMissing = previous?.missing && !current.transfer && !current.conflicts.length;
    const relocated =
      primaryMissing || current.primary === key
        ? {
            primary: key,
            destination: location,
            remoteRevision: document.revision,
            issue: undefined
          }
        : {};
    // Discovery cannot adopt provider changes while a move or exact upload owns the document.
    if (current.transfer) return { ...current, locations };
    if (current.upload && canonical(current.upload.document) === canonical(document))
      return { ...current, locations };
    if (canonical(current.document) === canonical(document))
      return { ...current, ...relocated, locations };
    if (primaryMissing && current.dirty && document.revision === current.remoteRevision)
      return { ...current, ...relocated, locations };
    // A primary file can advance a clean local snapshot. A divergent copy cannot silently win.
    if (
      !current.dirty &&
      !current.transfer &&
      (current.primary === key || primaryMissing) &&
      document.parents.includes(current.document.revision)
    )
      return {
        ...current,
        ...relocated,
        document,
        locations,
        remoteRevision: document.revision,
        issue: undefined
      };
    if (current.document.parents.includes(document.revision)) return { ...current, locations };
    const conflicts = current.conflicts.filter((other) => canonical(other) !== canonical(document));
    if (conflicts.length >= 8)
      throw new SnippetError(
        'conflict',
        'More conflicting copies were found. Original files remain unchanged.'
      );
    return {
      ...current,
      ...(current.primary === key
        ? { remoteRevision: document.revision, destination: location }
        : {}),
      locations,
      conflicts: [...conflicts, document],
      issue: 'Conflicting versions found. Both have been kept.'
    };
  });
}
export async function acknowledge(
  owner: string,
  id: string,
  uploaded: SnippetDocument,
  location: Location,
  guard: Guard
) {
  location = { ...location, observedRevision: uploaded.revision, missing: false };
  return mutateRecord(owner, id, guard, (current) => {
    if (!current) throw new Error('The saved snippet no longer exists locally.');
    if (
      current.transfer ||
      !current.upload ||
      canonical(current.upload.document) !== canonical(uploaded)
    )
      throw new Error('This upload no longer owns the pending save. Refresh before retrying.');
    return {
      ...current,
      upload: undefined,
      // A normal edit made while this immutable upload was in flight already
      // descends from the uploaded revision. Preserve that newer revision so an
      // open editor whose base is still valid does not conflict with its own
      // acknowledgement. Only synthesize ancestry for the bounded-history edge
      // case where the uploaded revision has already fallen out of parents.
      document:
        current.document.revision !== uploaded.revision &&
        !current.document.parents.includes(uploaded.revision)
          ? {
              ...current.document,
              revision: crypto.randomUUID(),
              parents: [
                ...new Set([
                  current.document.revision,
                  uploaded.revision,
                  ...current.document.parents
                ])
              ].slice(0, 16)
            }
          : current.document,
      locations: [
        ...current.locations.filter((item) => locationKey(item) !== locationKey(location)),
        location
      ],
      primary: locationKey(location),
      destination: location,
      remoteRevision: uploaded.revision,
      dirty: current.document.revision !== uploaded.revision,
      issue: undefined
    };
  });
}
export async function defaultDestination(owner: string) {
  return (await integrationDB()).get('metadata', `snippet-default:${owner}`) as Promise<
    Destination | undefined
  >;
}
export async function setDefaultDestination(
  owner: string,
  destination: Destination | undefined,
  guard: Guard
) {
  guard();
  const db = await integrationDB();
  guard();
  if (destination) await db.put('metadata', destination, `snippet-default:${owner}`);
  else await db.delete('metadata', `snippet-default:${owner}`);
}
export async function putTransfer(transfer: SnippetTransfer, guard: Guard) {
  guard();
  const db = await integrationDB(),
    tx = db.transaction('snippetTransfers', 'readwrite');
  try {
    const previous = await tx.store.get(transfer.key);
    guard();
    if (
      previous &&
      (previous.owner !== transfer.owner ||
        previous.snippetId !== transfer.snippetId ||
        previous.id !== transfer.id ||
        canonical(previous.document) !== canonical(transfer.document) ||
        !equal(previous.from, transfer.from) ||
        !equal(previous.to, transfer.to) ||
        previous.native !== transfer.native)
    )
      throw new Error('The move identity changed. All copies were kept.');
    const phases = { prepared: 0, copied: 1, complete: 2 };
    if (
      previous &&
      (phases[previous.phase] > phases[transfer.phase] ||
        (previous.attempted && !transfer.attempted))
    )
      throw new Error('This move already advanced in another tab. Reload its current status.');
    await tx.store.put(transfer);
    await tx.done;
    changed();
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* settled */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
/** Releasing editing and completing its journal must be one durable transaction. */
export async function finishTransfer(
  operation: SnippetTransfer,
  guard: Guard,
  update: (record: SnippetRecord) => SnippetRecord
) {
  guard();
  const db = await integrationDB(),
    tx = db.transaction(['snippets', 'snippetSummaries', 'snippetTransfers'], 'readwrite');
  try {
    const journal = await tx.objectStore('snippetTransfers').get(operation.key);
    const current = await tx
      .objectStore('snippets')
      .get(recordKey(operation.owner, operation.snippetId));
    guard();
    if (
      !journal ||
      journal.owner !== operation.owner ||
      journal.id !== operation.id ||
      journal.snippetId !== operation.snippetId
    )
      throw new Error('The move journal is unavailable.');
    if (journal.phase !== 'complete') {
      if (!current || current.transfer !== operation.id)
        throw new Error('This move no longer owns the snippet.');
      const next = update(current);
      if (
        next.owner !== current.owner ||
        next.key !== current.key ||
        canonical(next.document) !== canonical(current.document)
      )
        throw new Error('Completing a move cannot change its document or account.');
      const finished = { ...next, transfer: undefined };
      await tx.objectStore('snippets').put(finished);
      await tx.objectStore('snippetSummaries').put(summarize(finished));
      await tx
        .objectStore('snippetTransfers')
        .put({ ...journal, phase: 'complete', issue: operation.issue });
    }
    await tx.done;
    changed();
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* settled */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function transfers(owner: string) {
  return (await integrationDB()).getAllFromIndex('snippetTransfers', 'owner', owner);
}

/** Call only after a complete successful listing; an access failure is not deletion. */
export async function reconcileSourceListing(
  owner: string,
  source: SourceDescriptor,
  files: ReadonlySet<string>,
  guard: Guard
) {
  const sameSource = (item: Location) =>
    item.source.id === source.id &&
    item.source.owner === source.owner &&
    item.source.root === source.root;
  for (const record of await summaries(owner)) {
    guard();
    if (!record.locations.some((item) => sameSource(item as Location))) continue;
    await mutateRecord(
      owner,
      record.id,
      guard,
      (current) =>
        current && {
          ...current,
          locations: current.locations.map((item) =>
            sameSource(item) ? { ...item, missing: !files.has(item.fileId) } : item
          )
        }
    );
  }
}

/** Reserve the document and its move journal atomically, so a crash cannot strand editing. */
export async function beginTransfer(
  operation: SnippetTransfer,
  expectedRevision: string,
  guard: Guard
) {
  guard();
  const db = await integrationDB(),
    tx = db.transaction(['snippets', 'snippetSummaries', 'snippetTransfers'], 'readwrite');
  try {
    const current = await tx
      .objectStore('snippets')
      .get(recordKey(operation.owner, operation.snippetId));
    guard();
    if (
      !current ||
      current.transfer ||
      current.dirty ||
      current.conflicts.length ||
      current.document.revision !== expectedRevision ||
      canonical(current.document) !== canonical(operation.document)
    )
      throw new SnippetError(
        'conflict',
        'This snippet changed before the move. Nothing was removed.'
      );
    if (
      operation.key !== recordKey(operation.owner, operation.id) ||
      (await tx.objectStore('snippetTransfers').get(operation.key))
    )
      throw new Error('Invalid move operation.');
    const next = { ...current, transfer: operation.id, issue: undefined };
    await tx.objectStore('snippetTransfers').put(operation);
    await tx.objectStore('snippets').put(next);
    await tx.objectStore('snippetSummaries').put(summarize(next));
    await tx.done;
    changed();
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Retain local state; the next explicit refresh can retry. */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
