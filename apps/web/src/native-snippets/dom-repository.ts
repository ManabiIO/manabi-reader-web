/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** This adapter runs ONLY in the existing DOM owner. Never import it into a native route. */
import {
  summaries,
  drafts,
  getRecord,
  saveDraft,
  deleteDraft,
  mutateRecord,
  type SnippetDraft,
  type Destination
} from '../lib/snippets/database';
import { scope } from '../lib/snippets/scope';
import { commitSnippet, reloadSnippets } from '../lib/snippets/service';
import {
  canonical,
  editSnippet,
  retainRemoteAncestor,
  searchSnippet
} from '../lib/snippets/document';
import { sourceDescriptors } from '../lib/library/catalog';
import { capability, folders } from '../lib/snippets/storage';
import type { NativeSnippetsRepository } from './service';
import type { SnippetAuthority } from './contract';
/** Called afresh for every operation; both native session and domain account lifetime are fenced. */
function selected(authority: SnippetAuthority) {
  authority.signal.throwIfAborted();
  authority.assertCurrent();
  const current = scope();
  return {
    owner: current.owner,
    guard() {
      authority.signal.throwIfAborted();
      authority.assertCurrent();
      current.guard();
    }
  };
}
export function createNativeSnippetsRepository(): NativeSnippetsRepository {
  return {
    async load(authority) {
      const current = selected(authority);
      const [items, savedDrafts, sources] = await Promise.all([
        summaries(current.owner),
        drafts(current.owner),
        sourceDescriptors()
      ]);
      current.guard();
      const sourceRows = [];
      for (const source of sources) {
        current.guard();
        if (source.owner !== null && current.owner !== `account:${source.owner}`) continue;
        // File System Access handles cannot be requested or recreated from native controls.
        if (source.provider === 'local') {
          sourceRows.push({
            source,
            writable: false,
            reason:
              'Android persistent folder permission is not qualified. Save on this device or use an already connected cloud/WebDAV destination.'
          });
          continue;
        }
        try {
          const value = await capability(source, current.guard);
          current.guard();
          sourceRows.push({
            source,
            writable: value.write,
            reason:
              value.reason ||
              (!value.write
                ? 'Enable document write access in the web connection settings.'
                : undefined)
          });
        } catch {
          current.guard();
          sourceRows.push({
            source,
            writable: false,
            reason:
              'This connection is unavailable. Reconnect or grant document writes in the web connection settings.'
          });
        }
      }
      current.guard();
      return { owner: current.owner, items, drafts: savedDrafts, sources: sourceRows };
    },
    async read(id, authority) {
      const current = selected(authority);
      const result = await getRecord(current.owner, id);
      current.guard();
      return result;
    },
    async search(query, items, authority) {
      const current = selected(authority);
      const ids = new Set<string>();
      let bytes = 0;
      let complete = true;
      const normalized = query.normalize('NFKC').toLocaleLowerCase();
      // Title/excerpt matches are cheap and complete; body/ruby matches use the domain matcher.
      for (const item of items)
        if (
          `${item.title}\n${item.excerpt}`
            .normalize('NFKC')
            .toLocaleLowerCase()
            .includes(normalized)
        )
          ids.add(item.id);
      for (let index = 0; index < items.length; index++) {
        current.guard();
        if (index >= 500 || bytes > 16 * 1024 * 1024) {
          complete = false;
          break;
        }
        const record = await getRecord(current.owner, items[index].id);
        current.guard();
        if (record) {
          bytes += JSON.stringify(record.document).length * 2;
          if (searchSnippet(record.document, query, 1).length) ids.add(record.document.id);
        }
        if (index % 20 === 19) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          current.guard();
        }
      }
      return { ids, complete };
    },
    async checkpoint(draft, authority) {
      const current = selected(authority);
      own(draft, current.owner);
      await saveDraft(draft, current.guard);
      current.guard();
    },
    async discard(draft, authority) {
      const current = selected(authority);
      own(draft, current.owner);
      await deleteDraft(draft.key, current.guard);
      current.guard();
    },
    async save(draft, authority) {
      const current = selected(authority);
      own(draft, current.owner);
      const before = await getRecord(current.owner, draft.id);
      current.guard();
      // A saved immutable revision reconciles a lost acknowledgment; never create another document.
      // saveDocument may retain an older remote ancestor after the draft history reaches its bound.
      // That lineage augmentation does not make the same authored revision a different save.
      if (
        !before ||
        canonical({ ...before.document, parents: [] }) !==
          canonical({ ...draft.document, parents: [] })
      ) {
        if (draft.base === null && draft.destination)
          await writableDestination(draft.destination, current.guard);
        await commitSnippet(draft.document, draft.base, draft.destination, current);
      }
      current.guard();
      await deleteDraft(draft.key, current.guard);
      current.guard();
      // Existing snippet runtime owns the outbox. Do not create another sync owner or database.
    },
    async trash(id, revision, restore, authority) {
      const current = selected(authority);
      await mutateRecord(current.owner, id, current.guard, (record) => {
        if (!record || record.document.revision !== revision)
          throw new Error('This snippet changed. Refresh before deleting or restoring it.');
        if (record.transfer || record.conflicts.length)
          throw new Error('Resolve the pending move or conflict on web first.');
        const document = editSnippet(
          record.document,
          record.document.content,
          record.document.title.mode === 'custom' ? record.document.title.text : ''
        );
        if (restore) delete document.trashedAt;
        else document.trashedAt = Date.now();
        return {
          ...record,
          document: retainRemoteAncestor(document, record.remoteRevision),
          dirty: !!record.destination,
          issue: undefined
        };
      });
      await reloadSnippets(current);
      current.guard();
    },
    async folders(destination, authority) {
      const current = selected(authority);
      await writableDestination(destination, current.guard);
      const entries = await folders(destination.source, destination.parent, current.guard);
      current.guard();
      if (entries.length > 500)
        throw new Error(
          'This folder contains more than 500 subfolders. Choose a smaller destination in the web app.'
        );
      return entries;
    }
  };
}
function own(draft: SnippetDraft, owner: string) {
  if (draft.owner !== owner || draft.key !== JSON.stringify([owner, draft.session]))
    throw new Error('This draft belongs to another account.');
}
async function writableDestination(destination: Destination, guard: () => void) {
  guard();
  if (destination.source.provider === 'local')
    throw new Error(
      'Native folder writes are not available. Choose this device or a connected cloud/WebDAV destination.'
    );
  const sources = await sourceDescriptors();
  guard();
  if (!sources.some((source) => canonical(source) === canonical(destination.source)))
    throw new Error('This destination is no longer connected.');
  if (!(await capability(destination.source, guard)).write)
    throw new Error('This destination is no longer writable.');
  guard();
}
