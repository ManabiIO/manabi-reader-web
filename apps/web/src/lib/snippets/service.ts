/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get, writable, type Readable } from 'svelte/store';
import { account, currentUser, localUser } from '../manabi/client';
import { integrationDB, exclusive, setMetadata } from '../manabi/persistence';
import {
  librarySource,
  scanCatalog,
  sourceDescriptors,
  type Catalog,
  type SourceDescriptor
} from '../library/catalog';
import { sourceKey } from '../library/organization-keys';
import {
  canonical,
  retainRemoteAncestor,
  createSnippet,
  editSnippet,
  encodeSnippet,
  appendSnippet,
  type SnippetDocument,
  type TextNode
} from './document';
import {
  summaries,
  getRecord,
  mutateRecord,
  saveDocument,
  acceptRemote,
  acknowledge,
  locationKey,
  reconcileSourceListing,
  sourceListingFenceKey,
  defaultDestination,
  setDefaultDestination,
  type Destination,
  type SnippetRecord
} from './database';
import { prepareDestination, readDocument, writeDocument, capability } from './storage';
import { syncReading } from './reading-state';
import { scope, type SnippetScope } from './scope';
import type { SnippetSummary } from './summary';
export { scope } from './scope';
export type { SnippetScope } from './scope';

export const snippetItems = writable<SnippetSummary[]>([]);
export const snippetStatus = writable<{ busy: boolean; remaining: number; issues: string[] }>({
  busy: false,
  remaining: 0,
  issues: []
});
export const snippetLock = (owner: string, id: string) => `snippet:${owner}:${id}`;
export async function reloadSnippets(selected = scope()) {
  const values = await summaries(selected.owner);
  selected.guard();
  snippetItems.set(values);
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'The operation could not finish. Your local changes are safe.';
/** Persist the exact upload snapshot before I/O. A lost create reply cannot turn a later edit into a second create. */
export async function flushRecord(id: string, selected: SnippetScope) {
  let record = await getRecord(selected.owner, id);
  selected.guard();
  if (!record || !record.dirty || !record.destination || record.transfer || record.conflicts.length)
    return;
  try {
    if (!record.upload) {
      const primary = record.locations.find((l) => locationKey(l) === record!.primary);
      if (primary?.missing)
        throw new Error(
          'The original is missing. Choose a new location or save a new copy; it will not be recreated silently.'
        );
      const destination = primary
        ? { ...record.destination, name: primary.name }
        : await prepareDestination(record.destination, record.document, selected.guard);
      await mutateRecord(selected.owner, id, selected.guard, (current) => {
        if (!current || !current.dirty || current.transfer || current.conflicts.length)
          return current;
        if (canonical(current.destination) !== canonical(record!.destination))
          throw new Error('The save destination changed.');
        if (current.upload) return current;
        return {
          ...current,
          destination,
          upload: { document: structuredClone(current.document), destination, expected: primary },
          issue: undefined
        };
      });
      record = await getRecord(selected.owner, id);
      selected.guard();
    }
    if (!record?.upload) return;
    const pending = record.upload;
    const location = await writeDocument(
      pending.destination,
      pending.document,
      pending.expected,
      selected.guard
    );
    await acknowledge(selected.owner, id, pending.document, location, selected.guard);
    return true;
  } catch (error) {
    selected.guard();
    if (error instanceof Error && 'code' in error && error.code === 'conflict') {
      const original =
        record?.upload?.expected ??
        record?.locations.find((l) => locationKey(l) === record!.primary);
      if (original) {
        try {
          const remote = await readDocument(original.source, original.fileId, selected.guard);
          await acceptRemote(selected.owner, remote.document, remote.location, selected.guard);
        } catch {
          selected.guard();
        }
      }
    }
    await mutateRecord(
      selected.owner,
      id,
      selected.guard,
      (current) => current && { ...current, issue: message(error) }
    );
    throw error;
  }
}
export async function flushSnippets(selected = scope()) {
  selected.guard();
  const pending = (await summaries(selected.owner)).filter(
    (item) => item.dirty || item.progressDirty
  );
  for (const item of pending) {
    selected.guard();
    try {
      await exclusive(snippetLock(selected.owner, item.id), async () => {
        // Drain edits made while an older immutable snapshot was in flight.
        // Failed/blocked destinations stop immediately; only successful progress is retried.
        for (let pass = 0; pass < 4; pass++) {
          if (!(await flushRecord(item.id, selected))) break;
        }
        const current = await getRecord(selected.owner, item.id);
        selected.guard();
        if (current?.progressDirty && !current.transfer) await syncReading(item.id, selected);
      });
    } catch {
      selected.guard(); /* A failed source must not starve other queued saves. */
    }
  }
  await reloadSnippets(selected);
  return (await summaries(selected.owner)).some(
    (item) => item.dirty && item.destination && !item.issue && !item.transfer && !item.conflicts
  );
}
interface IndexCheckpoint {
  catalog: Catalog;
  index: number;
  failed: { id: string; name: string; message: string }[];
  finished: boolean;
}
const indexKey = (selected: SnippetScope, source: SourceDescriptor) =>
  `snippet-index:${selected.owner}:${sourceKey(source)}`;
/** Shared folder traversal, but bounded body hydration. The checkpoint advances only after accepting a file. */
export async function refreshSnippets(
  selected = scope(),
  rescan = true,
  minimumScanAge = 0,
  signal?: AbortSignal
) {
  const admitted = selected;
  selected = {
    owner: admitted.owner,
    guard() {
      admitted.guard();
      signal?.throwIfAborted();
    }
  };
  return exclusive(
    `snippet-discovery:${selected.owner}`,
    async () => {
      selected.guard();
      snippetStatus.set({ ...get(snippetStatus), busy: true });
      const issues: string[] = [];
      let remaining = 0,
        budget = 16 * 1024 * 1024,
        processed = 0;
      try {
        const sources = await sourceDescriptors();
        selected.guard();
        const db = await integrationDB();
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
          const source = sources[sourceIndex];
          selected.guard();
          if (source.owner !== null && source.owner !== currentUser()?.id) continue;
          try {
            let checkpoint = (await db.get('metadata', indexKey(selected, source))) as
              | IndexCheckpoint
              | undefined;
            const scanAge = checkpoint ? Date.now() - checkpoint.catalog.scannedAt : Infinity;
            const recentlyScanned = scanAge >= 0 && scanAge < minimumScanAge;
            if (!checkpoint || (rescan && checkpoint.finished && !recentlyScanned)) {
              // Capture exactly which locations this traversal is allowed to call
              // missing. A save/move/discovery acceptance after this point owns a
              // newer token/generation and cannot be invalidated by the older list.
              const beforeScan = await summaries(selected.owner);
              selected.guard();
              const listingFence = new Map(
                beforeScan.flatMap((record) =>
                  record.locations
                    .filter(
                      (location) =>
                        location.source.id === source.id &&
                        location.source.owner === source.owner &&
                        location.source.root === source.root
                    )
                    .map(
                      (location) =>
                        [
                          sourceListingFenceKey(record.id, location.fileId),
                          {
                            token: location.token,
                            observedRevision: location.observedRevision,
                            missing: location.missing
                          }
                        ] as const
                    )
                )
              );
              const catalog = await scanCatalog(
                await librarySource(source),
                source,
                signal,
                'snippet'
              );
              selected.guard();
              checkpoint = { catalog, index: 0, failed: [], finished: false };
              await setMetadata(indexKey(selected, source), checkpoint, signal);
              selected.guard();
              await reconcileSourceListing(
                selected.owner,
                source,
                new Set(catalog.entries.filter((e) => e.kind === 'file').map((e) => e.id)),
                listingFence,
                selected.guard
              );
            }
            const files = checkpoint.catalog.entries.filter((e) => e.kind === 'file');
            // Preserve a fair share of each bounded pass for every remaining source.
            // A large Dropbox folder must not make a small Drive/WebDAV source wait
            // through dozens of one-second continuation passes before its first body
            // becomes searchable.
            const remainingSources = Math.max(1, sources.length - sourceIndex);
            const sourceLimit = Math.max(1, Math.ceil((100 - processed) / remainingSources));
            const sourceByteLimit = Math.max(1, Math.ceil(budget / remainingSources));
            let sourceProcessed = 0,
              sourceBytes = 0;
            while (
              checkpoint.index < files.length &&
              processed < 100 &&
              sourceProcessed < sourceLimit &&
              (sourceProcessed === 0 || sourceBytes < sourceByteLimit) &&
              budget > 0
            ) {
              const file = files[checkpoint.index];
              selected.guard();
              try {
                const remote = await readDocument(source, file, selected.guard);
                selected.guard();
                const bytes = new TextEncoder().encode(encodeSnippet(remote.document)).length;
                budget -= bytes;
                sourceBytes += bytes;
                await acceptRemote(
                  selected.owner,
                  remote.document,
                  remote.location,
                  selected.guard
                );
              } catch (error) {
                selected.guard();
                checkpoint.failed.push({ id: file.id, name: file.name, message: message(error) });
              }
              checkpoint.index++;
              processed++;
              sourceProcessed++;
              checkpoint.finished = checkpoint.index === files.length;
              selected.guard();
              await setMetadata(indexKey(selected, source), checkpoint, signal);
            }
            if (!files.length) {
              checkpoint.finished = true;
              await setMetadata(indexKey(selected, source), checkpoint, signal);
            }
            remaining += files.length - checkpoint.index;
            for (const failure of checkpoint.failed.slice(0, 5))
              issues.push(`${source.name} · ${failure.name}: ${failure.message}`);
            if (checkpoint.failed.length > 5)
              issues.push(
                `${checkpoint.failed.length - 5} more files in ${source.name} could not be indexed.`
              );
          } catch (error) {
            selected.guard();
            issues.push(`${source.provider} · ${source.name}: ${message(error)}`);
          }
        }
        await reloadSnippets(selected);
      } finally {
        admitted.guard();
        if (!signal?.aborted) snippetStatus.set({ busy: false, remaining, issues });
      }
    },
    signal
  );
}
export async function suggestedDestination(
  selected = scope(),
  explicit?: Destination
): Promise<Destination | undefined> {
  selected.guard();
  if (explicit) return explicit;
  const remembered = await defaultDestination(selected.owner);
  selected.guard();
  if (remembered) return remembered;
  const sources = await sourceDescriptors();
  selected.guard();
  const eligible: SourceDescriptor[] = [];
  for (const source of sources) {
    try {
      if ((await capability(source, selected.guard)).write) eligible.push(source);
    } catch {
      selected.guard();
    }
  }
  // No provider ordering preference; multiple writable homes always require a visible choice.
  if (eligible.length !== 1) return;
  return { source: eligible[0], parent: eligible[0].root };
}
export async function commitSnippet(
  document: SnippetDocument,
  base: string | null,
  destination: Destination | undefined,
  selected = scope()
) {
  const value = await saveDocument(selected.owner, document, base, destination, selected.guard);
  await reloadSnippets(selected);
  return value;
}
export async function appendToSnippet(
  id: string,
  content: TextNode,
  operation: string,
  selected = scope()
) {
  await mutateRecord(selected.owner, id, selected.guard, (current) => {
    if (!current || current.document.trashedAt || current.conflicts.length || current.transfer)
      throw new Error('This snippet is unavailable for appending. The capture was kept.');
    if (current.document.captures.includes(operation))
      throw new Error(
        'This capture was already appended. Your recovered draft is kept; make a new snippet or discard it.'
      );
    const document = retainRemoteAncestor(
      appendSnippet(current.document, content, operation),
      current.remoteRevision
    );
    return { ...current, document, dirty: !!current.destination, issue: undefined };
  });

  // The IndexedDB mutation above is authoritative and records the capture
  // receipt atomically. A presentation refresh failure after that point must
  // not report the append as failed and invite a duplicate retry.
  try {
    await reloadSnippets(selected);
  } catch {
    /* The committed mutation already broadcast its change. A later refresh can republish summaries. */
  }
}
export async function duplicateSnippet(id: string, selected = scope()) {
  const record = await getRecord(selected.owner, id);
  selected.guard();
  if (!record) throw new Error('Snippet no longer exists.');
  const document = createSnippet(
    record.document.content,
    record.document.title.mode === 'custom' ? record.document.title.text : ''
  );
  document.source = record.document.source;
  // An explicit duplicate receives a new identity; it is not another writable replica.
  await commitSnippet(document, null, await suggestedDestination(selected), selected);
  return document.id;
}
export async function trashSnippet(id: string, restore = false, selected = scope()) {
  await mutateRecord(selected.owner, id, selected.guard, (current) => {
    if (!current || current.transfer || current.conflicts.length)
      throw new Error('Resolve this snippet’s pending operation first.');
    const document = editSnippet(
      current.document,
      current.document.content,
      current.document.title.mode === 'custom' ? current.document.title.text : ''
    );
    if (restore) delete document.trashedAt;
    else document.trashedAt = Date.now();
    return {
      ...current,
      document: retainRemoteAncestor(document, current.remoteRevision),
      dirty: !!current.destination,
      issue: undefined
    };
  });
  await reloadSnippets(selected);
}
/** Choosing a version makes a fresh revision descending from every version shown to the user. */
export async function resolveConflict(
  id: string,
  chosen: SnippetDocument,
  expectedRevision: string,
  selected = scope()
) {
  await mutateRecord(selected.owner, id, selected.guard, (current) => {
    if (
      !current ||
      current.transfer ||
      current.document.revision !== expectedRevision ||
      ![current.document, ...current.conflicts].some((d) => canonical(d) === canonical(chosen))
    )
      throw new Error('The conflict changed. Review the current versions.');
    const document = {
      ...structuredClone(chosen),
      revision: crypto.randomUUID(),
      parents: [
        ...new Set([
          current.document.revision,
          ...current.conflicts.map((d) => d.revision),
          ...(current.remoteRevision ? [current.remoteRevision] : [])
        ])
      ].slice(0, 16),
      modifiedAt: Math.max(Date.now(), chosen.modifiedAt)
    };
    return {
      ...current,
      document,
      conflicts: [],
      upload: undefined,
      dirty: !!current.destination,
      issue: undefined
    };
  });
  await reloadSnippets(selected);
}
/** Refresh the primary copy before entering Edit; disconnected sources never remove local content. */
export async function refreshSnippet(
  id: string,
  selected = scope()
): Promise<SnippetRecord | undefined> {
  let current = await getRecord(selected.owner, id);
  selected.guard();
  const location = current?.locations.find(
    (l) => locationKey(l) === current?.primary && !l.missing
  );
  if (location && !current?.transfer) {
    try {
      const remote = await readDocument(location.source, location.fileId, selected.guard);
      await acceptRemote(selected.owner, remote.document, remote.location, selected.guard);
    } catch (error) {
      selected.guard();
      await mutateRecord(
        selected.owner,
        id,
        selected.guard,
        (c) => c && { ...c, issue: message(error) }
      );
    }
    try {
      await syncReading(id, selected);
    } catch {
      selected.guard();
    }
    current = await getRecord(selected.owner, id);
    selected.guard();
  }
  return current;
}
export async function rememberDestination(
  destination: Destination | undefined,
  selected = scope()
) {
  await setDefaultDestination(selected.owner, destination, selected.guard);
}
let runtimeUsers = 0,
  runtimeStop: (() => void) | undefined;
export function startSnippets(discovery: Readable<boolean>) {
  if (++runtimeUsers === 1) {
    let disposed = false,
      discovering = false,
      scanController: AbortController | undefined,
      load = 0,
      owner = '',
      timer: ReturnType<typeof setTimeout> | undefined,
      indexTimer: ReturnType<typeof setTimeout> | undefined,
      lastScan = 0;
    const publish = async () => {
      const run = ++load;
      try {
        const selected = scope();
        const values = await summaries(selected.owner);
        selected.guard();
        if (!disposed && run === load) snippetItems.set(values);
      } catch {
        if (!disposed && run === load) snippetItems.set([]);
      }
    };
    let syncing = false,
      syncQueued = false;
    const finishSync = (more = false) => {
      syncing = false;
      if (disposed) return;
      if (more || syncQueued) {
        syncQueued = false;
        sync();
      }
    };
    const sync = () => {
      if (syncing) {
        syncQueued = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          syncing = true;
          syncQueued = false;
          const selected = scope();
          void flushSnippets(selected)
            .then((more) => finishSync(more))
            .catch(() => finishSync());
        } catch {
          finishSync();
        }
      }, 800);
    };
    const scan = (force = false, continueIndex = false) => {
      if (disposed || !discovering || (scanController && !scanController.signal.aborted)) return;
      try {
        const selected = scope();
        if (!force && Date.now() - lastScan < 60000) return;
        lastScan = Date.now();
        const controller = (scanController = new AbortController());
        // A page reload starts a new runtime. Reuse its durable discovery
        // checkpoint briefly instead of traversing every cloud folder again.
        void refreshSnippets(selected, !continueIndex, 60000, controller.signal)
          .then(() => {
            if (disposed || controller.signal.aborted || scanController !== controller) return;
            if (get(snippetStatus).remaining) {
              clearTimeout(indexTimer);
              indexTimer = setTimeout(() => scan(true, true), 1000);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (scanController === controller) scanController = undefined;
          });
      } catch {
        /* Retain local state; the next explicit refresh can retry. */
      }
    };
    const onChange = () => {
      void publish();
      sync();
    };
    const onAccount = () => {
      try {
        const next = scope().owner;
        if (next !== owner) {
          scanController?.abort();
          clearTimeout(indexTimer);
          owner = next;
          load++;
          snippetItems.set([]);
          snippetStatus.set({ busy: false, remaining: 0, issues: [] });
          lastScan = 0;
          void publish();
          scan(true);
        }
        sync();
      } catch {
        load++;
        snippetItems.set([]);
      }
    };
    const stopUser = localUser.subscribe(onAccount),
      stopAccount = account.subscribe(onAccount);
    const stopDiscovery = discovery.subscribe((enabled) => {
      if (discovering === enabled) return;
      discovering = enabled;
      scanController?.abort();
      clearTimeout(indexTimer);
      if (enabled) {
        lastScan = 0;
        scan(true);
      } else snippetStatus.update((status) => ({ ...status, busy: false }));
    });
    const onFocus = () => {
      void publish();
      scan();
      sync();
    };
    window.addEventListener('manabi-snippets-changed', onChange);
    window.addEventListener('online', onFocus);
    window.addEventListener('focus', onFocus);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel('manabi-snippets');
      channel.onmessage = onChange;
    } catch {
      /* Retain local state; the next explicit refresh can retry. */
    }
    runtimeStop = () => {
      disposed = true;
      scanController?.abort();
      load++;
      clearTimeout(timer);
      clearTimeout(indexTimer);
      stopUser();
      stopAccount();
      stopDiscovery();
      channel?.close();
      window.removeEventListener('manabi-snippets-changed', onChange);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }
  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      if (--runtimeUsers === 0) {
        runtimeStop?.();
        runtimeStop = undefined;
      }
    }
  };
}
