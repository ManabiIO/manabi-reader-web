/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { exclusive, integrationDB } from '../manabi/persistence';
import { canonical, isUUID } from './document';
import {
  beginTransfer,
  finishTransfer,
  getRecord,
  locationKey,
  putTransfer,
  recordKey,
  type Destination,
  type SnippetTransfer
} from './database';
import {
  capability,
  moveWithinSource,
  prepareDestination,
  readDocument,
  removeDocument,
  sameSource,
  writeDocument
} from './storage';
import { flushRecord, reloadSnippets, snippetLock, scope, type SnippetScope } from './service';
import { syncReading } from './reading-state';

function issue(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The move could not finish. Original and verified destination copies are preserved.';
}
export async function currentTransfer(id: string, selected = scope()) {
  const record = await getRecord(selected.owner, id);
  selected.guard();
  if (!record?.transfer) return;
  return (await integrationDB()).get(
    'snippetTransfers',
    recordKey(selected.owner, record.transfer)
  );
}
/** Verify the saved copy at each asynchronous boundary before destructive cleanup. */
async function verifyDestination(operation: SnippetTransfer, selected: SnippetScope) {
  if (!operation.copied) throw new Error('The verified destination receipt is missing.');
  const destination = await readDocument(
    operation.copied.source,
    operation.copied.fileId,
    selected.guard
  );
  if (
    canonical(destination.document) !== canonical(operation.document) ||
    destination.location.token !== operation.copied.token
  )
    throw new Error(
      'The destination was edited after copying. Keep both versions or resolve it before cleanup.'
    );
}
/** Caller holds the per-document Web Lock. The journal, not the active UI, owns every locator. */
async function execute(operation: SnippetTransfer, selected: SnippetScope) {
  selected.guard();
  if (
    operation.owner !== selected.owner ||
    operation.key !== recordKey(selected.owner, operation.id)
  )
    throw new Error('This move belongs to another account.');
  if (operation.phase === 'complete') return;
  try {
    if (operation.phase === 'prepared') {
      if (!operation.attempted) {
        operation = { ...operation, attempted: true, issue: undefined };
        await putTransfer(operation, selected.guard);
      }
      const copied =
        operation.native && operation.from
          ? await moveWithinSource(operation.from, operation.to, operation.document, selected.guard)
          : await writeDocument(operation.to, operation.document, undefined, selected.guard);
      if (!copied)
        throw new Error('The selected move operation is unavailable. No original was removed.');
      const verified = await readDocument(copied.source, copied.fileId, selected.guard);
      if (canonical(verified.document) !== canonical(operation.document))
        throw new Error('The destination changed. No original will be removed.');
      operation = { ...operation, phase: 'copied', copied: verified.location, issue: undefined };
      await putTransfer(operation, selected.guard);
    }
    if (!operation.copied) throw new Error('The verified destination receipt is missing.');
    await verifyDestination(operation, selected);
    // Reading state is small, separately revision checked, and must travel before the original is removed.
    await syncReading(operation.snippetId, selected, operation.copied);
    // State I/O may outlive the earlier verification. An external writer must
    // not turn that delay into permission to delete the only original revision.
    await verifyDestination(operation, selected);
    if (
      operation.from &&
      !operation.native &&
      locationKey(operation.from) !== locationKey(operation.copied)
    ) {
      try {
        await removeDocument(operation.from, operation.document, selected.guard);
      } catch (error) {
        // A lost successful delete reply can be reconciled only by an actual not-found response.
        // Authorization, disconnection and network errors are not deletion evidence.
        if (!(error instanceof Error && 'code' in error && error.code === 'not_found')) throw error;
        const cap = await capability(operation.from.source, selected.guard);
        if (!cap.write) throw error;
      }
    }
    await finishTransfer(operation, selected.guard, (current) => ({
      ...current,
      destination: operation.copied,
      primary: locationKey(operation.copied!),
      remoteRevision: operation.document.revision,
      dirty: false,
      upload: undefined,
      issue: undefined,
      locations: [
        ...current.locations.filter(
          (l) =>
            locationKey(l) !== locationKey(operation.copied!) &&
            (!operation.from || locationKey(l) !== locationKey(operation.from))
        ),
        { ...operation.copied!, observedRevision: operation.document.revision }
      ]
    }));
  } catch (error) {
    selected.guard();
    await putTransfer({ ...operation, issue: issue(error) }, selected.guard);
    throw error;
  } finally {
    await reloadSnippets(selected);
  }
}
export async function moveSnippet(
  id: string,
  to: Destination,
  expectedRevision: string,
  selected = scope()
) {
  if (!isUUID(id)) throw new Error('Invalid snippet.');
  return exclusive(snippetLock(selected.owner, id), async () => {
    selected.guard();
    let current = await getRecord(selected.owner, id);
    selected.guard();
    if (!current || current.document.revision !== expectedRevision)
      throw new Error('The snippet changed before the move. Refresh and try again.');
    // A save must finish before taking an immutable move snapshot.
    await flushRecord(id, selected);
    current = await getRecord(selected.owner, id);
    selected.guard();
    if (!current || current.dirty || current.upload || current.transfer || current.conflicts.length)
      throw new Error('Finish pending saves or resolve conflicts before moving.');
    if (!(await capability(to.source, selected.guard)).write)
      throw new Error('The destination is read-only.');
    const from = current.locations.find((l) => locationKey(l) === current?.primary && !l.missing);
    if (current.primary && !from)
      throw new Error(
        'The original is missing. Export or duplicate the retained document instead of deleting an unknown source.'
      );
    if (from && sameSource(from.source, to.source) && from.parent === to.parent) return;
    if (from) {
      await syncReading(id, selected);
    }
    const native = !!from && from.source.owner !== null && sameSource(from.source, to.source);
    const destination = native
      ? { source: to.source, parent: to.parent, name: from!.name }
      : await prepareDestination(
          { source: to.source, parent: to.parent },
          current.document,
          selected.guard
        );
    const operationId = crypto.randomUUID();
    const operation: SnippetTransfer = {
      key: recordKey(selected.owner, operationId),
      owner: selected.owner,
      id: operationId,
      snippetId: id,
      document: structuredClone(current.document),
      from,
      to: destination,
      native,
      phase: 'prepared'
    };
    await beginTransfer(operation, current.document.revision, selected.guard);
    return execute(operation, selected);
  });
}
export async function resumeTransfer(id: string, selected = scope()) {
  return exclusive(snippetLock(selected.owner, id), async () => {
    const operation = await currentTransfer(id, selected);
    selected.guard();
    if (operation) await execute(operation, selected);
  });
}
/** Retain both files deliberately. Never delete a destination merely because an acknowledgement was lost. */
export async function keepBoth(id: string, selected = scope()) {
  return exclusive(snippetLock(selected.owner, id), async () => {
    const operation = await currentTransfer(id, selected);
    selected.guard();
    if (!operation) return;
    let divergent: Awaited<ReturnType<typeof readDocument>> | undefined;
    if (operation.copied) {
      const remote = await readDocument(
        operation.copied.source,
        operation.copied.fileId,
        selected.guard
      );
      if (canonical(remote.document) !== canonical(operation.document)) divergent = remote;
    }
    await finishTransfer(
      {
        ...operation,
        issue: operation.copied
          ? 'Both locations were kept. Only the selected primary is edited.'
          : undefined
      },
      selected.guard,
      (current) => ({
        ...current,
        ...(operation.copied
          ? {
              destination: operation.copied,
              primary: locationKey(operation.copied),
              remoteRevision: operation.document.revision,
              locations: [
                ...current.locations.filter(
                  (l) => locationKey(l) !== locationKey(operation.copied!)
                ),
                { ...operation.copied, observedRevision: operation.document.revision }
              ]
            }
          : {}),
        ...(divergent
          ? {
              remoteRevision: divergent.document.revision,
              locations: [
                ...current.locations.filter(
                  (l) => locationKey(l) !== locationKey(divergent!.location)
                ),
                divergent.location
              ],
              conflicts: [
                ...current.conflicts.filter((d) => canonical(d) !== canonical(divergent!.document)),
                divergent.document
              ]
            }
          : {}),
        issue: divergent
          ? 'The destination changed. Both versions are kept for conflict review.'
          : operation.copied
            ? 'Both locations were kept. Only this primary copy is edited.'
            : operation.attempted
              ? 'The copy or move result is uncertain. No copies were deleted; refresh sources to locate them.'
              : undefined
      })
    );
    await reloadSnippets(selected);
  });
}
