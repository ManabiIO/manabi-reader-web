/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { createRouteLoads, type RouteLoad } from '../lib/snippets/route-load';
import { page } from '$app/stores';
import { base, resolve } from '$app/paths';
import { beforeNavigate, goto, replaceState } from '$app/navigation';
import { account, localUser, providerLabels } from '../lib/manabi/client';
import {
  organization,
  watchOrganization,
  setMembershipMany,
  createCollection
} from '../lib/library/organization';
import {
  snippetItems,
  snippetStatus,
  scope,
  commitSnippet,
  appendToSnippet,
  refreshSnippet,
  flushSnippets,
  reloadSnippets,
  suggestedDestination,
  rememberDestination,
  trashSnippet,
  resolveConflict,
  type SnippetScope
} from '../lib/snippets/service';
import {
  drafts,
  saveDraft,
  deleteDraft,
  getRecord,
  recordKey,
  type SnippetDraft,
  type SnippetRecord,
  type Destination
} from '../lib/snippets/database';
import {
  canonical,
  createSnippet,
  editSnippet,
  displayTitle,
  identifyBlocks,
  isUUID,
  parseSnippet,
  passages,
  plainContent,
  snippetKey,
  MAX_SNIPPET_BYTES,
  type SnippetDocument,
  type TextNode
} from '../lib/snippets/document';
import { currentTransfer, moveSnippet } from '../lib/snippets/transfers';
import { parseLocator, safeReturn, snippetSourceId } from '../lib/snippets/presentation';
import { restoreBackup, MAX_BACKUP_BYTES } from '../lib/snippets/portability';
import type { Editor } from '@tiptap/core';
import { ReaderController, type StoreValue } from '../reader-react/controller';

export interface WorkspaceProps {
  /** This Expo screen's URL; browser/global history may still belong to another screen. */
  routeUrl?: string;
}

export function createWorkspace(
  props: WorkspaceProps,
  _emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let routeUrl = props.routeUrl;
  let pageUrl: URL;
  let params: URLSearchParams;
  let routeURL: string;
  let id: string;
  let draftId: string;
  let trashed: boolean;
  let collectionId: string;
  let collection: import('../lib/library/organization').Collection | undefined;
  let locator: ReturnType<typeof parseLocator>;
  let nextQueryURL: string;
  let desiredRoute: string;
  let selectedSummary: import('../lib/snippets/summary').SnippetSummary | undefined;
  let sourceSnippetId: string;
  let nextRecordSignature: string;
  let automaticTitle: string;
  let sources: [string, string][];
  let $page: StoreValue<typeof page> = __readerController.read(page);
  let $organization: StoreValue<typeof organization> = __readerController.read(organization);
  let $snippetItems: StoreValue<typeof snippetItems> = __readerController.read(snippetItems);
  let $snippetStatus: StoreValue<typeof snippetStatus> = __readerController.read(snippetStatus);
  let EditorView: typeof import('./editor').SnippetEditor | undefined;
  let mounted = false,
    owner = '',
    current: SnippetRecord | undefined,
    admitted: SnippetScope | undefined;
  let editing: SnippetDraft | undefined,
    content: TextNode = plainContent(''),
    title = '',
    destination: Destination | undefined,
    locationChosen = false;
  let instance: Editor | undefined,
    busy = false,
    annotationPending = false,
    error = '',
    notice = '',
    draftStatus = '',
    draftError = false,
    renderGeneration = 0;
  let storedDrafts: SnippetDraft[] = [],
    draftQueue: Promise<void> = Promise.resolve(),
    draftClock = 0,
    draftSerial = 0;
  let query = '',
    queryURL = '',
    source = '',
    layout: 'list' | 'grid' = 'list',
    sort: 'edited' | 'read' | 'created' | 'title' = 'edited';
  let selecting = false,
    selected = new Set<string>(),
    visibleIds: string[] = [];
  let pickerOpen = false,
    pickerWriteBusy = false,
    pickerPurpose: 'save' | 'move' | 'default' = 'save',
    moving: {
      id: string;
      revision: string;
    }[] = [];
  let collectionsOpen = false,
    collectionTargets: string[] = [],
    newCollection = '',
    deleteOpen = false,
    deleteIds: string[] = [];
  const routeLoads = createRouteLoads();
  let importInput: HTMLInputElement,
    recordSignature = '',
    routeGeneration = 0,
    collectionStop: () => void = () => undefined;
  let leaveOpen = false,
    leaveTarget = '',
    transferIssue = '';
  __readerController.effect(
    () => [routeUrl ?? $page.url],
    () => {
      __readerController.changed((pageUrl = routeUrl ? new URL(routeUrl) : $page.url));
    }
  );
  __readerController.effect(
    () => [mounted, pageUrl],
    () => {
      __readerController.changed((params = mounted ? pageUrl.searchParams : new URLSearchParams()));
    }
  );
  __readerController.effect(
    () => [mounted, pageUrl],
    () => {
      __readerController.changed(
        (routeURL = mounted ? pageUrl.pathname + pageUrl.search : base + '/snippets')
      );
    }
  );
  __readerController.effect(
    () => [params],
    () => {
      __readerController.changed((id = params.get('id') ?? ''));
    }
  );
  __readerController.effect(
    () => [params],
    () => {
      __readerController.changed((draftId = params.get('draft') ?? ''));
    }
  );
  __readerController.effect(
    () => [params],
    () => {
      __readerController.changed((trashed = params.get('trash') === '1'));
    }
  );
  __readerController.effect(
    () => [params],
    () => {
      __readerController.changed((collectionId = params.get('collection') ?? ''));
    }
  );
  __readerController.effect(
    () => [$organization, collectionId],
    () => {
      __readerController.changed(
        (collection = $organization.collections.find((c) => c.id === collectionId))
      );
    }
  );
  __readerController.effect(
    () => [params],
    () => {
      __readerController.changed((locator = parseLocator(params.get('locator'))));
    }
  );
  __readerController.effect(
    () => [params],
    () => {
      __readerController.changed((nextQueryURL = params.get('q') ?? ''));
    }
  );
  __readerController.effect(
    () => [nextQueryURL],
    () => {
      if (queryURL !== nextQueryURL) {
        __readerController.changed((queryURL = nextQueryURL));
        __readerController.changed((query = nextQueryURL));
      }
    }
  );
  __readerController.effect(
    () => [owner, id, draftId],
    () => {
      __readerController.changed((desiredRoute = JSON.stringify([owner, id, draftId])));
    }
  );
  __readerController.effect(
    () => [mounted, admitted, routeLoads, desiredRoute],
    () => {
      if (mounted && admitted) {
        const request = routeLoads.begin(desiredRoute);
        if (request) void loadRoute(request);
      }
    }
  );
  __readerController.effect(
    () => [$snippetItems, id],
    () => {
      __readerController.changed((selectedSummary = $snippetItems.find((item) => item.id === id)));
    }
  );
  __readerController.effect(
    () => [current],
    () => {
      __readerController.changed(
        (sourceSnippetId = snippetSourceId(current?.document.source?.item) ?? '')
      );
    }
  );
  __readerController.effect(
    () => [selectedSummary],
    () => {
      __readerController.changed(
        (nextRecordSignature = JSON.stringify([
          selectedSummary?.revision,
          selectedSummary?.dirty,
          selectedSummary?.issue,
          selectedSummary?.conflicts,
          selectedSummary?.transfer,
          selectedSummary?.progressAt
        ]))
      );
    }
  );
  __readerController.effect(
    () => [mounted, admitted, editing, nextRecordSignature],
    () => {
      if (mounted && admitted && !editing && recordSignature !== nextRecordSignature) {
        __readerController.changed((recordSignature = nextRecordSignature));
        void loadRecord(false);
      }
    }
  );
  __readerController.effect(
    () => [editing],
    () => {
      __readerController.changed(
        (automaticTitle = displayTitle({
          ...(editing?.document ?? createPlaceholder()),
          title: { mode: 'automatic', text: '' },
          content
        }))
      );
    }
  );
  __readerController.effect(
    () => [$snippetItems, providerName],
    () => {
      __readerController.changed(
        (sources = [
          ...new Map(
            $snippetItems
              .filter((item) => item.destination)
              .map((item) => {
                const s = item.destination!.source;
                return [
                  JSON.stringify([s.owner, s.id, s.root]),
                  `${providerName(s.provider)} · ${s.name}`
                ];
              })
          ).entries()
        ])
      );
    }
  );
  function createPlaceholder(): SnippetDocument {
    return {
      format: 'manabi-snippet',
      version: 1,
      id: '',
      revision: '',
      parents: [],
      title: { mode: 'automatic', text: '' },
      createdAt: 0,
      modifiedAt: 0,
      content: plainContent(''),
      captures: []
    };
  }
  const report = (reason: unknown) =>
    reason instanceof Error ? reason.message : 'The operation could not finish. Your text is kept.';
  const providerName = (provider: string) =>
    providerLabels[provider] ??
    (provider === 'local' ? 'Local folder' : provider === 'webdav' ? 'WebDAV' : provider);
  function listURL(values: Record<string, string> = {}) {
    const q = new URLSearchParams(params);
    for (const key of ['id', 'draft', 'locator', 'returnTo']) q.delete(key);
    for (const [key, value] of Object.entries(values)) {
      if (value) q.set(key, value);
      else q.delete(key);
    }
    return `${base}/snippets${q.size ? '?' + q : ''}`;
  }
  type LibraryPath = '/snippets' | '/manage' | `/snippets?${string}` | `/manage?${string}`;
  function libraryPath(raw: string | null): LibraryPath {
    const url = new URL(safeReturn(raw, base), 'https://reader.invalid');
    const path = url.pathname === `${base}/manage` ? '/manage' : '/snippets';
    return url.search ? `${path}?${url.search.slice(1)}` : path;
  }
  function backURL() {
    return id ? safeReturn(params.get('returnTo'), base) : listURL();
  }
  function editorReturn() {
    return editing?.base
      ? `${base}/snippets?${new URLSearchParams({ id: editing.id, returnTo: backURL() })}`
      : listURL();
  }
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    __readerController.changed((busy = true));
    __readerController.changed((error = ''));
    try {
      await work();
    } catch (reason) {
      __readerController.changed((error = report(reason)));
    } finally {
      __readerController.changed((busy = false));
    }
  }
  async function loadRecord(remote: boolean, request?: RouteLoad) {
    const run = __readerController.changed(++routeGeneration),
      selectedId = id;
    try {
      const selectedScope = scope();
      if (!isUUID(selectedId)) {
        __readerController.changed((current = undefined));
        return;
      }
      const item = remote
        ? await refreshSnippet(selectedId, selectedScope)
        : await getRecord(selectedScope.owner, selectedId);
      selectedScope.guard();
      request?.guard();
      if (run !== routeGeneration || editing || !mounted || selectedId !== id) return;
      const issue = item?.transfer
        ? ((await currentTransfer(selectedId, selectedScope))?.issue ?? '')
        : '';
      selectedScope.guard();
      request?.guard();
      if (run !== routeGeneration || editing || !mounted || selectedId !== id) return;
      __readerController.changed((current = item));
      __readerController.changed((transferIssue = issue));
    } catch (reason) {
      if (run === routeGeneration && mounted && (!request || request.current()))
        __readerController.changed((error = report(reason)));
    }
  }
  async function loadRoute(request: RouteLoad) {
    if (editing) return;
    const selectedDraftId = draftId,
      selectedId = id,
      url = new URL(pageUrl);
    __readerController.changed((current = undefined));
    __readerController.changed((error = ''));
    __readerController.changed((notice = ''));
    try {
      const selected = scope();
      const s: SnippetScope = {
        owner: selected.owner,
        guard() {
          selected.guard();
          request.guard();
        }
      };
      const found = await drafts(s.owner);
      s.guard();
      __readerController.changed((storedDrafts = found));
      if (selectedDraftId && isUUID(selectedDraftId)) {
        const draft = found.find((d) => d.session === selectedDraftId);
        if (draft) {
          const session = crypto.randomUUID();
          const restored = {
            ...draft,
            key: recordKey(s.owner, session),
            session,
            operation: draft.operation ?? draft.session
          };
          await saveDraft(restored, s.guard);
          s.guard();
          // A recovery handoff keeps the same request owner. Publish its durable
          // URL before deleting the previous session or mounting the editor.
          url.searchParams.set('draft', session);
          request.replace(JSON.stringify([s.owner, selectedId, session]));
          replaceState(resolve(libraryPath(url.pathname + url.search)), $page.state);
          if (routeUrl !== undefined) __readerController.changed((routeUrl = url.href));
          await deleteDraft(draft.key, s.guard);
          s.guard();
          await openDraft(restored, s);
        } else
          __readerController.changed((error = 'This draft is unavailable in the current account.'));
      } else await loadRecord(true, request);
    } catch (reason) {
      if (request.current() && mounted) __readerController.changed((error = report(reason)));
    }
  }
  async function openDraft(draft: SnippetDraft, s: SnippetScope) {
    s.guard();
    __readerController.changed((editing = structuredClone(draft)));
    __readerController.changed((content = editing.document.content));
    __readerController.changed(
      (title = editing.document.title.mode === 'custom' ? editing.document.title.text : '')
    );
    __readerController.changed((destination = editing.destination));
    __readerController.changed(
      (locationChosen = !!editing.destination || !!editing.locationChosen)
    );
    __readerController.changed((draftStatus = 'Draft saved on this device'));
    __readerController.changed((draftError = false));
    __readerController.changed((instance = undefined));
    __readerController.changed((annotationPending = false));
    const run = __readerController.changed(++renderGeneration);
    const view = await import('./editor');
    s.guard();
    if (run === renderGeneration && editing?.session === draft.session && mounted)
      __readerController.changed((EditorView = view.SnippetEditor));
  }
  function snapshot(): SnippetDraft | undefined {
    if (!editing || !admitted) return;
    return {
      ...editing,
      document: {
        ...editing.document,
        content: identifyBlocks(content),
        title: { mode: title.trim() ? 'custom' : 'automatic', text: title.trim() }
      },
      destination,
      locationChosen,
      updatedAt: __readerController.changed((draftClock = Math.max(Date.now(), draftClock + 1)))
    };
  }
  function persist(): Promise<void> {
    const value = snapshot(),
      s = admitted;
    if (!value || !s) return Promise.resolve();
    const run = __readerController.changed(++draftSerial);
    __readerController.changed((draftStatus = 'Saving draft…'));
    __readerController.changed((draftError = false));
    const pending = draftQueue.catch(() => undefined).then(() => saveDraft(value, s.guard));
    __readerController.changed((draftQueue = pending));
    void pending
      .then(() => {
        if (editing?.session === value.session && run === draftSerial) {
          __readerController.changed((draftStatus = 'Draft saved on this device'));
          __readerController.changed((draftError = false));
        }
      })
      .catch((reason) => {
        if (editing?.session === value.session && run === draftSerial) {
          __readerController.changed((draftStatus = 'Draft could not be saved'));
          __readerController.changed((draftError = true));
          __readerController.changed((error = report(reason)));
        }
      });
    return pending;
  }
  function changedContent(value: TextNode) {
    __readerController.changed((content = value));
    void persist();
  }
  async function newSnippet(initial?: TextNode, copy?: SnippetDocument) {
    const s = scope();
    const document = createSnippet(
      initial ?? plainContent(''),
      copy?.title.mode === 'custom' ? copy.title.text : ''
    );
    if (copy?.source) document.source = copy.source;
    const session = crypto.randomUUID();
    const dest = await suggestedDestination(s);
    s.guard();
    const draft: SnippetDraft = {
      key: recordKey(s.owner, session),
      owner: s.owner,
      id: document.id,
      session,
      base: null,
      document,
      destination: dest,
      locationChosen: !!dest,
      updatedAt: Date.now(),
      mode: 'new'
    };
    await saveDraft(draft, s.guard);
    await openDraft(draft, s);
    __readerController.changed((current = undefined));
  }
  async function edit(mode: 'edit' | 'append' = 'edit') {
    if (!current) return;
    const s = scope(),
      item = await refreshSnippet(current.document.id, s);
    s.guard();
    if (!item || item.transfer || item.conflicts.length)
      throw new Error('Finish the move or resolve conflicting versions before editing.');
    __readerController.changed((current = item));
    const document =
        mode === 'append'
          ? { ...createSnippet(), id: item.document.id }
          : structuredClone(item.document),
      session = crypto.randomUUID();
    const draft: SnippetDraft = {
      key: recordKey(s.owner, session),
      owner: s.owner,
      id: item.document.id,
      session,
      base: item.document.revision,
      document,
      destination: item.destination,
      locationChosen: true,
      updatedAt: Date.now(),
      mode,
      operation: session
    };
    await saveDraft(draft, s.guard);
    await openDraft(draft, s);
  }
  async function save() {
    if (!editing || !admitted) return;
    if (annotationPending) throw new Error('Apply or cancel the furigana or link before saving.');
    if (instance?.view.composing) throw new Error('Finish Japanese text conversion before saving.');
    if (!passages(content).some((p) => p.text.trim()))
      throw new Error('Add some text before saving.');
    if (!locationChosen && editing.mode !== 'append') {
      __readerController.changed((pickerPurpose = 'save'));
      __readerController.changed((pickerOpen = true));
      return;
    }
    await persist();
    const draft = editing,
      s = admitted;
    if (draft.mode === 'append')
      await appendToSnippet(draft.id, content, draft.operation ?? draft.session, s);
    else {
      // Imported documents keep their ID, but edited contents must not reuse the original revision.
      const document = editSnippet(draft.document, content, title);
      await commitSnippet(document, draft.base, destination, s);
    }
    const returning = backURL();
    __readerController.changed((editing = undefined));
    __readerController.changed((instance = undefined));
    __readerController.changed(
      (notice = 'Saved. Cloud changes will finish when the destination is available.')
    );
    try {
      await deleteDraft(draft.key, s.guard);
    } catch {
      __readerController.changed(
        (notice = 'Saved, but draft cleanup could not finish. The saved document is safe.')
      );
    }
    __readerController.changed((storedDrafts = await drafts(s.owner)));
    s.guard();
    await goto(resolve(`/snippets?${new URLSearchParams({ id: draft.id, returnTo: returning })}`));
    await loadRecord(false);
    void flushSnippets(s).catch(() => undefined);
  }
  async function closeEditor(discard = false) {
    if (!editing || !admitted) return;
    if (!discard && annotationPending)
      throw new Error('Apply or cancel the furigana or link first.');
    const key = editing.key,
      s = admitted,
      target = editorReturn();
    if (discard) {
      await draftQueue.catch(() => undefined);
      await deleteDraft(key, s.guard);
    } else await persist();
    __readerController.changed((editing = undefined));
    __readerController.changed((instance = undefined));
    __readerController.changed((storedDrafts = await drafts(s.owner)));
    s.guard();
    await goto(resolve(libraryPath(target)));
  }
  async function paste(format: 'auto' | 'text' | 'markdown' = 'auto') {
    const s = scope();
    const editor = await import('../lib/snippets/editor');
    s.guard();
    let text = '',
      kind: 'text' | 'html' | 'markdown' = format === 'markdown' ? 'markdown' : 'text';
    // Clipboard permissions are explicit user actions; never inspect the clipboard on page load.
    if (format === 'auto' && navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      s.guard();
      const html = items.find((i) => i.types.includes('text/html'));
      if (html) {
        text = await (await html.getType('text/html')).text();
        kind = 'html';
      } else {
        const plain = items.find((i) => i.types.includes('text/plain'));
        if (plain) text = await (await plain.getType('text/plain')).text();
      }
    } else text = await navigator.clipboard.readText();
    s.guard();
    if (!text.trim())
      throw new Error('The clipboard is empty. Use New snippet and paste into the editor.');
    await newSnippet(editor.importContent(text, kind));
  }
  async function importFile(file: File) {
    const s = scope();
    if (
      file.size >
      (file.name.endsWith('.manabi-snippets.json') ? MAX_BACKUP_BYTES : MAX_SNIPPET_BYTES)
    )
      throw new Error('This file exceeds the snippet import limit.');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    s.guard();
    if (file.name.endsWith('.manabi-snippets.json')) {
      const count = await restoreBackup(raw, s);
      await reloadSnippets(s);
      __readerController.changed(
        (notice = `Restored ${count} snippets on this device. Select them and use Move to choose a connected storage home.`)
      );
      return;
    }
    if (file.name.endsWith('.manabi-snippet.json')) {
      const document = parseSnippet(raw);
      const existing = await getRecord(s.owner, document.id);
      s.guard();
      if (existing) {
        const divergent = canonical(existing.document) !== canonical(document);
        if (divergent) {
          await restoreBackup(
            canonical({
              format: 'manabi-snippets-export',
              version: 1,
              items: [document],
              collections: []
            }),
            s
          );
          s.guard();
          await reloadSnippets(s);
        }
        await goto(resolve(`/snippets?id=${document.id}`));
        s.guard();
        if (divergent)
          __readerController.changed(
            (notice =
              'A different version was imported. Both versions are kept until you choose one.')
          );
        return;
      }
      const session = crypto.randomUUID(),
        dest = await suggestedDestination(s);
      s.guard();
      const draft: SnippetDraft = {
        key: recordKey(s.owner, session),
        owner: s.owner,
        id: document.id,
        session,
        base: null,
        document,
        destination: dest,
        locationChosen: !!dest,
        updatedAt: Date.now(),
        mode: 'new'
      };
      await saveDraft(draft, s.guard);
      await openDraft(draft, s);
      return;
    }
    const { importContent } = await import('../lib/snippets/editor');
    s.guard();
    await newSnippet(
      importContent(
        raw,
        /\.md$/i.test(file.name) ? 'markdown' : /\.html?$/i.test(file.name) ? 'html' : 'text'
      )
    );
  }
  function move(ids: string[]) {
    __readerController.changed(
      (moving = ids.map((id) => {
        const item = $snippetItems.find((d) => d.id === id);
        if (!item) throw new Error('A selected snippet is missing.');
        return { id, revision: item.revision };
      }))
    );
    __readerController.changed((pickerPurpose = 'move'));
    __readerController.changed((pickerOpen = true));
  }
  async function chooseDestination(value: Destination | undefined, remember: boolean) {
    if (!admitted) return;
    const s = admitted;
    s.guard();
    if (pickerPurpose === 'move') {
      if (!value) throw new Error('Choose a connected destination for this move.');
      const failures: string[] = [];
      for (const item of moving) {
        try {
          await moveSnippet(item.id, value, item.revision, s);
        } catch (reason) {
          s.guard();
          failures.push(report(reason));
        }
      }
      __readerController.changed(
        (notice = failures.length
          ? `${failures.length} move(s) need attention. Verified copies and originals were kept.`
          : 'Moved without changing document identities or collections.')
      );
      if (failures.length) __readerController.changed((error = failures.join('\n')));
    } else if (pickerPurpose === 'default') {
      await rememberDestination(value, s);
      __readerController.changed(
        (notice = value
          ? 'Default snippet location updated.'
          : 'Default cleared. New snippets use the only writable source or ask when there are several.')
      );
    } else {
      __readerController.changed((destination = value));
      __readerController.changed((locationChosen = true));
      await persist();
    }
    if (remember && pickerPurpose !== 'default') await rememberDestination(value, s);
    __readerController.changed((pickerOpen = false));
    await loadRecord(false);
  }
  function membership(ids: string[]) {
    __readerController.changed((collectionTargets = ids.map(snippetKey)));
    __readerController.changed((newCollection = ''));
    __readerController.changed((collectionsOpen = true));
  }
  async function toggleCollection(id: string, included: boolean) {
    const s = scope(),
      targets = [...collectionTargets];
    await setMembershipMany(id, targets, included, s.guard);
    s.guard();
  }
  async function addCollection() {
    const s = scope(),
      targets = [...collectionTargets];
    await createCollection(newCollection, targets, s.guard);
    s.guard();
    __readerController.changed((newCollection = ''));
  }
  async function removeSelected() {
    if (!admitted) return;
    const failures: string[] = [];
    for (const id of deleteIds) {
      try {
        await trashSnippet(id, false, admitted);
      } catch (reason) {
        failures.push(report(reason));
      }
    }
    __readerController.changed((deleteOpen = false));
    __readerController.changed((selected = new Set()));
    __readerController.changed(
      (notice = failures.length
        ? failures.join('\n')
        : 'Moved to Trash. Restore remains available.')
    );
    await loadRecord(false);
  }
  async function chooseVersion(doc: SnippetDocument) {
    if (!current || !admitted) return;
    await resolveConflict(current.document.id, doc, current.document.revision, admitted);
    await loadRecord(false);
    void flushSnippets(admitted).catch(() => undefined);
  }
  function selection(ids: string[]) {
    __readerController.changed((selected = new Set(ids)));
    if (ids.length) __readerController.changed((selecting = true));
  }
  function resetTransientAccountState() {
    __readerController.changed((editing = undefined));
    __readerController.changed((instance = undefined));
    __readerController.changed((current = undefined));
    __readerController.changed((content = plainContent('')));
    __readerController.changed((title = ''));
    __readerController.changed((destination = undefined));
    __readerController.changed((locationChosen = false));
    __readerController.changed((storedDrafts = []));
    __readerController.changed((draftQueue = Promise.resolve()));
    __readerController.changed((draftClock = 0));
    __readerController.changed(draftSerial++);
    __readerController.changed((selected = new Set()));
    __readerController.changed((selecting = false));
    __readerController.changed((visibleIds = []));
    __readerController.changed((source = ''));
    __readerController.changed((pickerOpen = false));
    __readerController.changed((pickerWriteBusy = false));
    __readerController.changed((moving = []));
    __readerController.changed((collectionsOpen = false));
    __readerController.changed((collectionTargets = []));
    __readerController.changed((newCollection = ''));
    __readerController.changed((deleteOpen = false));
    __readerController.changed((deleteIds = []));
    __readerController.changed((leaveOpen = false));
    __readerController.changed((leaveTarget = ''));
    __readerController.changed((transferIssue = ''));
    __readerController.changed((draftStatus = ''));
    __readerController.changed((draftError = false));
    __readerController.changed((annotationPending = false));
    __readerController.changed((recordSignature = ''));
    __readerController.changed((notice = ''));
    __readerController.changed((error = ''));
  }
  function updateQuery() {
    void goto(resolve(libraryPath(listURL({ q: query }))), {
      replaceState: true,
      noScroll: true,
      keepFocus: true
    });
  }
  __readerController.onDestroy(
    beforeNavigate((navigation) => {
      if (!editing || !navigation.to) return;
      if (navigation.willUnload) {
        navigation.cancel();
        return;
      }
      navigation.cancel();
      __readerController.changed(
        (leaveTarget =
          navigation.to.url.pathname + navigation.to.url.search + navigation.to.url.hash)
      );
      __readerController.changed((leaveOpen = true));
    })
  );
  async function leave(discard: boolean) {
    if (!discard && annotationPending)
      throw new Error('Apply or cancel the furigana or link first.');
    const target = leaveTarget;
    if (discard) {
      await draftQueue.catch(() => undefined);
      if (editing && admitted) await deleteDraft(editing.key, admitted.guard);
    } else await persist();
    __readerController.changed((editing = undefined));
    __readerController.changed((instance = undefined));
    __readerController.changed((leaveOpen = false));
    await goto(resolve(libraryPath(target)));
  }
  __readerController.onMount(() => {
    __readerController.changed((mounted = true));
    let stopped = false;
    const onAccount = () => {
      try {
        const s = scope();
        if (owner === s.owner) return;
        __readerController.changed((owner = s.owner));
        __readerController.changed((admitted = s));
        __readerController.changed(routeGeneration++);
        resetTransientAccountState();
        collectionStop();
        __readerController.changed(
          (collectionStop = watchOrganization((reason) => {
            if (!stopped) __readerController.changed((error = report(reason)));
          }))
        );
        routeLoads.reset();
        void reloadSnippets(s).catch(() => undefined);
      } catch {
        routeLoads.reset();
        __readerController.changed(routeGeneration++);
        __readerController.changed((owner = ''));
        __readerController.changed((admitted = undefined));
        resetTransientAccountState();
      }
    };
    const stopA = account.subscribe(onAccount),
      stopB = localUser.subscribe(onAccount);
    return () => {
      stopped = true;
      routeLoads.reset();
      __readerController.changed((mounted = false));
      __readerController.changed(routeGeneration++);
      stopA();
      stopB();
      collectionStop();
    };
  });
  __readerController.observeSource(
    () => page,
    (value) => {
      $page = value;
    }
  );
  __readerController.observeSource(
    () => organization,
    (value) => {
      $organization = value;
    }
  );
  __readerController.observeSource(
    () => snippetItems,
    (value) => {
      $snippetItems = value;
    }
  );
  __readerController.observeSource(
    () => snippetStatus,
    (value) => {
      $snippetStatus = value;
    }
  );
  const api = {
    controller: __readerController,
    createPlaceholder,
    listURL,
    libraryPath,
    backURL,
    editorReturn,
    action,
    loadRecord,
    loadRoute,
    openDraft,
    snapshot,
    persist,
    changedContent,
    newSnippet,
    edit,
    save,
    closeEditor,
    paste,
    importFile,
    move,
    chooseDestination,
    membership,
    toggleCollection,
    addCollection,
    removeSelected,
    chooseVersion,
    selection,
    resetTransientAccountState,
    updateQuery,
    leave,
    get EditorView() {
      return EditorView;
    },
    set EditorView(nextValue: typeof EditorView) {
      if (Object.is(EditorView, nextValue)) return;
      EditorView = nextValue;
      __readerController.invalidate();
    },
    get mounted() {
      return mounted;
    },
    set mounted(nextValue: typeof mounted) {
      if (Object.is(mounted, nextValue)) return;
      mounted = nextValue;
      __readerController.invalidate();
    },
    get owner() {
      return owner;
    },
    set owner(nextValue: typeof owner) {
      if (Object.is(owner, nextValue)) return;
      owner = nextValue;
      __readerController.invalidate();
    },
    get current() {
      return current;
    },
    set current(nextValue: typeof current) {
      if (Object.is(current, nextValue)) return;
      current = nextValue;
      __readerController.invalidate();
    },
    get admitted() {
      return admitted;
    },
    set admitted(nextValue: typeof admitted) {
      if (Object.is(admitted, nextValue)) return;
      admitted = nextValue;
      __readerController.invalidate();
    },
    get editing() {
      return editing;
    },
    set editing(nextValue: typeof editing) {
      if (Object.is(editing, nextValue)) return;
      editing = nextValue;
      __readerController.invalidate();
    },
    get content() {
      return content;
    },
    set content(nextValue: typeof content) {
      if (Object.is(content, nextValue)) return;
      content = nextValue;
      __readerController.invalidate();
    },
    get title() {
      return title;
    },
    set title(nextValue: typeof title) {
      if (Object.is(title, nextValue)) return;
      title = nextValue;
      __readerController.invalidate();
    },
    get destination() {
      return destination;
    },
    set destination(nextValue: typeof destination) {
      if (Object.is(destination, nextValue)) return;
      destination = nextValue;
      __readerController.invalidate();
    },
    get locationChosen() {
      return locationChosen;
    },
    set locationChosen(nextValue: typeof locationChosen) {
      if (Object.is(locationChosen, nextValue)) return;
      locationChosen = nextValue;
      __readerController.invalidate();
    },
    get instance() {
      return instance;
    },
    set instance(nextValue: typeof instance) {
      if (Object.is(instance, nextValue)) return;
      instance = nextValue;
      __readerController.invalidate();
    },
    get busy() {
      return busy;
    },
    set busy(nextValue: typeof busy) {
      if (Object.is(busy, nextValue)) return;
      busy = nextValue;
      __readerController.invalidate();
    },
    get annotationPending() {
      return annotationPending;
    },
    set annotationPending(nextValue: typeof annotationPending) {
      if (Object.is(annotationPending, nextValue)) return;
      annotationPending = nextValue;
      __readerController.invalidate();
    },
    get error() {
      return error;
    },
    set error(nextValue: typeof error) {
      if (Object.is(error, nextValue)) return;
      error = nextValue;
      __readerController.invalidate();
    },
    get notice() {
      return notice;
    },
    set notice(nextValue: typeof notice) {
      if (Object.is(notice, nextValue)) return;
      notice = nextValue;
      __readerController.invalidate();
    },
    get draftStatus() {
      return draftStatus;
    },
    set draftStatus(nextValue: typeof draftStatus) {
      if (Object.is(draftStatus, nextValue)) return;
      draftStatus = nextValue;
      __readerController.invalidate();
    },
    get draftError() {
      return draftError;
    },
    set draftError(nextValue: typeof draftError) {
      if (Object.is(draftError, nextValue)) return;
      draftError = nextValue;
      __readerController.invalidate();
    },
    get renderGeneration() {
      return renderGeneration;
    },
    set renderGeneration(nextValue: typeof renderGeneration) {
      if (Object.is(renderGeneration, nextValue)) return;
      renderGeneration = nextValue;
      __readerController.invalidate();
    },
    get storedDrafts() {
      return storedDrafts;
    },
    set storedDrafts(nextValue: typeof storedDrafts) {
      if (Object.is(storedDrafts, nextValue)) return;
      storedDrafts = nextValue;
      __readerController.invalidate();
    },
    get draftQueue() {
      return draftQueue;
    },
    set draftQueue(nextValue: typeof draftQueue) {
      if (Object.is(draftQueue, nextValue)) return;
      draftQueue = nextValue;
      __readerController.invalidate();
    },
    get draftClock() {
      return draftClock;
    },
    set draftClock(nextValue: typeof draftClock) {
      if (Object.is(draftClock, nextValue)) return;
      draftClock = nextValue;
      __readerController.invalidate();
    },
    get draftSerial() {
      return draftSerial;
    },
    set draftSerial(nextValue: typeof draftSerial) {
      if (Object.is(draftSerial, nextValue)) return;
      draftSerial = nextValue;
      __readerController.invalidate();
    },
    get query() {
      return query;
    },
    set query(nextValue: typeof query) {
      if (Object.is(query, nextValue)) return;
      query = nextValue;
      __readerController.invalidate();
    },
    get queryURL() {
      return queryURL;
    },
    set queryURL(nextValue: typeof queryURL) {
      if (Object.is(queryURL, nextValue)) return;
      queryURL = nextValue;
      __readerController.invalidate();
    },
    get source() {
      return source;
    },
    set source(nextValue: typeof source) {
      if (Object.is(source, nextValue)) return;
      source = nextValue;
      __readerController.invalidate();
    },
    get layout() {
      return layout;
    },
    set layout(nextValue: typeof layout) {
      if (Object.is(layout, nextValue)) return;
      layout = nextValue;
      __readerController.invalidate();
    },
    get sort() {
      return sort;
    },
    set sort(nextValue: typeof sort) {
      if (Object.is(sort, nextValue)) return;
      sort = nextValue;
      __readerController.invalidate();
    },
    get selecting() {
      return selecting;
    },
    set selecting(nextValue: typeof selecting) {
      if (Object.is(selecting, nextValue)) return;
      selecting = nextValue;
      __readerController.invalidate();
    },
    get selected() {
      return selected;
    },
    set selected(nextValue: typeof selected) {
      if (Object.is(selected, nextValue)) return;
      selected = nextValue;
      __readerController.invalidate();
    },
    get visibleIds() {
      return visibleIds;
    },
    set visibleIds(nextValue: typeof visibleIds) {
      if (Object.is(visibleIds, nextValue)) return;
      visibleIds = nextValue;
      __readerController.invalidate();
    },
    get pickerOpen() {
      return pickerOpen;
    },
    set pickerOpen(nextValue: typeof pickerOpen) {
      if (Object.is(pickerOpen, nextValue)) return;
      pickerOpen = nextValue;
      __readerController.invalidate();
    },
    get pickerWriteBusy() {
      return pickerWriteBusy;
    },
    set pickerWriteBusy(nextValue: typeof pickerWriteBusy) {
      if (Object.is(pickerWriteBusy, nextValue)) return;
      pickerWriteBusy = nextValue;
      __readerController.invalidate();
    },
    get pickerPurpose() {
      return pickerPurpose;
    },
    set pickerPurpose(nextValue: typeof pickerPurpose) {
      if (Object.is(pickerPurpose, nextValue)) return;
      pickerPurpose = nextValue;
      __readerController.invalidate();
    },
    get moving() {
      return moving;
    },
    set moving(nextValue: typeof moving) {
      if (Object.is(moving, nextValue)) return;
      moving = nextValue;
      __readerController.invalidate();
    },
    get collectionsOpen() {
      return collectionsOpen;
    },
    set collectionsOpen(nextValue: typeof collectionsOpen) {
      if (Object.is(collectionsOpen, nextValue)) return;
      collectionsOpen = nextValue;
      __readerController.invalidate();
    },
    get collectionTargets() {
      return collectionTargets;
    },
    set collectionTargets(nextValue: typeof collectionTargets) {
      if (Object.is(collectionTargets, nextValue)) return;
      collectionTargets = nextValue;
      __readerController.invalidate();
    },
    get newCollection() {
      return newCollection;
    },
    set newCollection(nextValue: typeof newCollection) {
      if (Object.is(newCollection, nextValue)) return;
      newCollection = nextValue;
      __readerController.invalidate();
    },
    get deleteOpen() {
      return deleteOpen;
    },
    set deleteOpen(nextValue: typeof deleteOpen) {
      if (Object.is(deleteOpen, nextValue)) return;
      deleteOpen = nextValue;
      __readerController.invalidate();
    },
    get deleteIds() {
      return deleteIds;
    },
    set deleteIds(nextValue: typeof deleteIds) {
      if (Object.is(deleteIds, nextValue)) return;
      deleteIds = nextValue;
      __readerController.invalidate();
    },
    get routeLoads() {
      return routeLoads;
    },
    get importInput() {
      return importInput;
    },
    set importInput(nextValue: typeof importInput) {
      if (Object.is(importInput, nextValue)) return;
      importInput = nextValue;
      __readerController.invalidate();
    },
    get recordSignature() {
      return recordSignature;
    },
    set recordSignature(nextValue: typeof recordSignature) {
      if (Object.is(recordSignature, nextValue)) return;
      recordSignature = nextValue;
      __readerController.invalidate();
    },
    get routeGeneration() {
      return routeGeneration;
    },
    set routeGeneration(nextValue: typeof routeGeneration) {
      if (Object.is(routeGeneration, nextValue)) return;
      routeGeneration = nextValue;
      __readerController.invalidate();
    },
    get collectionStop() {
      return collectionStop;
    },
    set collectionStop(nextValue: typeof collectionStop) {
      if (Object.is(collectionStop, nextValue)) return;
      collectionStop = nextValue;
      __readerController.invalidate();
    },
    get leaveOpen() {
      return leaveOpen;
    },
    set leaveOpen(nextValue: typeof leaveOpen) {
      if (Object.is(leaveOpen, nextValue)) return;
      leaveOpen = nextValue;
      __readerController.invalidate();
    },
    get leaveTarget() {
      return leaveTarget;
    },
    set leaveTarget(nextValue: typeof leaveTarget) {
      if (Object.is(leaveTarget, nextValue)) return;
      leaveTarget = nextValue;
      __readerController.invalidate();
    },
    get transferIssue() {
      return transferIssue;
    },
    set transferIssue(nextValue: typeof transferIssue) {
      if (Object.is(transferIssue, nextValue)) return;
      transferIssue = nextValue;
      __readerController.invalidate();
    },
    get report() {
      return report;
    },
    get providerName() {
      return providerName;
    },
    get params() {
      return params;
    },
    set params(nextValue: typeof params) {
      if (Object.is(params, nextValue)) return;
      params = nextValue;
      __readerController.invalidate();
    },
    get routeURL() {
      return routeURL;
    },
    set routeURL(nextValue: typeof routeURL) {
      if (Object.is(routeURL, nextValue)) return;
      routeURL = nextValue;
      __readerController.invalidate();
    },
    get id() {
      return id;
    },
    set id(nextValue: typeof id) {
      if (Object.is(id, nextValue)) return;
      id = nextValue;
      __readerController.invalidate();
    },
    get draftId() {
      return draftId;
    },
    set draftId(nextValue: typeof draftId) {
      if (Object.is(draftId, nextValue)) return;
      draftId = nextValue;
      __readerController.invalidate();
    },
    get trashed() {
      return trashed;
    },
    set trashed(nextValue: typeof trashed) {
      if (Object.is(trashed, nextValue)) return;
      trashed = nextValue;
      __readerController.invalidate();
    },
    get collectionId() {
      return collectionId;
    },
    set collectionId(nextValue: typeof collectionId) {
      if (Object.is(collectionId, nextValue)) return;
      collectionId = nextValue;
      __readerController.invalidate();
    },
    get collection() {
      return collection;
    },
    set collection(nextValue: typeof collection) {
      if (Object.is(collection, nextValue)) return;
      collection = nextValue;
      __readerController.invalidate();
    },
    get locator() {
      return locator;
    },
    set locator(nextValue: typeof locator) {
      if (Object.is(locator, nextValue)) return;
      locator = nextValue;
      __readerController.invalidate();
    },
    get nextQueryURL() {
      return nextQueryURL;
    },
    set nextQueryURL(nextValue: typeof nextQueryURL) {
      if (Object.is(nextQueryURL, nextValue)) return;
      nextQueryURL = nextValue;
      __readerController.invalidate();
    },
    get desiredRoute() {
      return desiredRoute;
    },
    set desiredRoute(nextValue: typeof desiredRoute) {
      if (Object.is(desiredRoute, nextValue)) return;
      desiredRoute = nextValue;
      __readerController.invalidate();
    },
    get selectedSummary() {
      return selectedSummary;
    },
    set selectedSummary(nextValue: typeof selectedSummary) {
      if (Object.is(selectedSummary, nextValue)) return;
      selectedSummary = nextValue;
      __readerController.invalidate();
    },
    get sourceSnippetId() {
      return sourceSnippetId;
    },
    set sourceSnippetId(nextValue: typeof sourceSnippetId) {
      if (Object.is(sourceSnippetId, nextValue)) return;
      sourceSnippetId = nextValue;
      __readerController.invalidate();
    },
    get nextRecordSignature() {
      return nextRecordSignature;
    },
    set nextRecordSignature(nextValue: typeof nextRecordSignature) {
      if (Object.is(nextRecordSignature, nextValue)) return;
      nextRecordSignature = nextValue;
      __readerController.invalidate();
    },
    get automaticTitle() {
      return automaticTitle;
    },
    set automaticTitle(nextValue: typeof automaticTitle) {
      if (Object.is(automaticTitle, nextValue)) return;
      automaticTitle = nextValue;
      __readerController.invalidate();
    },
    get sources() {
      return sources;
    },
    set sources(nextValue: typeof sources) {
      if (Object.is(sources, nextValue)) return;
      sources = nextValue;
      __readerController.invalidate();
    },
    get $page() {
      return $page;
    },
    get $organization() {
      return $organization;
    },
    get $snippetItems() {
      return $snippetItems;
    },
    get $snippetStatus() {
      return $snippetStatus;
    },
    updateProps(next: Record<string, unknown>) {
      if ('routeUrl' in next && !Object.is(routeUrl, next.routeUrl))
        __readerController.changed((routeUrl = next.routeUrl as string | undefined));
    }
  };
  return api;
}
