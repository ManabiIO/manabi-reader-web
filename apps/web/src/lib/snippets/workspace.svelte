<script lang="ts">
  import { onMount } from 'svelte';
  import { createRouteLoads, type RouteLoad } from './route-load';
  import { page } from '$app/stores';
  import { base, resolve } from '$app/paths';
  import { beforeNavigate, goto, replaceState } from '$app/navigation';
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
  import { account, localUser, providerLabels } from '../manabi/client';
  import {
    organization,
    watchOrganization,
    setMembershipMany,
    createCollection
  } from '../library/organization';
  import {
    snippetItems,
    snippetStatus,
    scope,
    commitSnippet,
    appendToSnippet,
    refreshSnippet,
    refreshSnippets,
    flushSnippets,
    reloadSnippets,
    suggestedDestination,
    rememberDestination,
    trashSnippet,
    resolveConflict,
    type SnippetScope
  } from './service';
  import {
    drafts,
    saveDraft,
    deleteDraft,
    getRecord,
    recordKey,
    type SnippetDraft,
    type SnippetRecord,
    type Destination
  } from './database';
  import {
    canonical,
    createSnippet,
    editSnippet,
    displayTitle,
    encodeSnippet,
    identifyBlocks,
    isUUID,
    parseSnippet,
    passages,
    plainContent,
    snippetKey,
    snippetSearchTooLong,
    MAX_SNIPPET_BYTES,
    filename,
    type SnippetDocument,
    type TextNode
  } from './document';
  import { currentTransfer, moveSnippet, resumeTransfer, keepBoth } from './transfers';
  import { parseLocator, safeReturn, saveLabel, snippetSourceId } from './presentation';
  import { exportSnippets, restoreBackup, MAX_BACKUP_BYTES, download } from './portability';
  import Shelf from './shelf.svelte';
  import Reader from './reader.svelte';
  import DestinationPicker from './destination-picker.svelte';
  import type { Editor } from '@tiptap/core';
  let EditorView: typeof import('./editor.svelte').default | undefined;
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
    moving: { id: string; revision: string }[] = [];
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
  $: params = mounted ? $page.url.searchParams : new URLSearchParams();
  $: routeURL = mounted ? $page.url.pathname + $page.url.search : base + '/snippets';
  $: id = params.get('id') ?? '';
  $: draftId = params.get('draft') ?? '';
  $: trashed = params.get('trash') === '1';
  $: collectionId = params.get('collection') ?? '';
  $: collection = $organization.collections.find((c) => c.id === collectionId);
  $: locator = parseLocator(params.get('locator'));
  $: nextQueryURL = params.get('q') ?? '';
  $: if (queryURL !== nextQueryURL) {
    queryURL = nextQueryURL;
    query = nextQueryURL;
  }
  $: desiredRoute = JSON.stringify([owner, id, draftId]);
  $: if (mounted && admitted) {
    const request = routeLoads.begin(desiredRoute);
    if (request) void loadRoute(request);
  }
  $: selectedSummary = $snippetItems.find((item) => item.id === id);
  $: sourceSnippetId = snippetSourceId(current?.document.source?.item) ?? '';
  $: nextRecordSignature = JSON.stringify([
    selectedSummary?.revision,
    selectedSummary?.dirty,
    selectedSummary?.issue,
    selectedSummary?.conflicts,
    selectedSummary?.transfer,
    selectedSummary?.progressAt
  ]);
  $: if (mounted && admitted && !editing && recordSignature !== nextRecordSignature) {
    recordSignature = nextRecordSignature;
    void loadRecord(false);
  }
  $: automaticTitle = displayTitle({
    ...(editing?.document ?? createPlaceholder()),
    title: { mode: 'automatic', text: '' },
    content
  });
  $: sources = [
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
  ];
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
    for (const [key, value] of Object.entries(values)) value ? q.set(key, value) : q.delete(key);
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
    busy = true;
    error = '';
    try {
      await work();
    } catch (reason) {
      error = report(reason);
    } finally {
      busy = false;
    }
  }
  async function loadRecord(remote: boolean, request?: RouteLoad) {
    const run = ++routeGeneration,
      selectedId = id;
    try {
      const selectedScope = scope();
      if (!isUUID(selectedId)) {
        current = undefined;
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
      current = item;
      transferIssue = issue;
    } catch (reason) {
      if (run === routeGeneration && mounted && (!request || request.current()))
        error = report(reason);
    }
  }
  async function loadRoute(request: RouteLoad) {
    if (editing) return;
    const selectedDraftId = draftId,
      selectedId = id,
      url = new URL($page.url);
    current = undefined;
    error = '';
    notice = '';
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
      storedDrafts = found;
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
          await deleteDraft(draft.key, s.guard);
          s.guard();
          await openDraft(restored, s);
        } else error = 'This draft is unavailable in the current account.';
      } else await loadRecord(true, request);
    } catch (reason) {
      if (request.current() && mounted) error = report(reason);
    }
  }
  async function openDraft(draft: SnippetDraft, s: SnippetScope) {
    s.guard();
    editing = structuredClone(draft);
    content = editing.document.content;
    title = editing.document.title.mode === 'custom' ? editing.document.title.text : '';
    destination = editing.destination;
    locationChosen = !!editing.destination || !!editing.locationChosen;
    draftStatus = 'Draft saved on this device';
    draftError = false;
    instance = undefined;
    annotationPending = false;
    const run = ++renderGeneration;
    const view = await import('./editor.svelte');
    s.guard();
    if (run === renderGeneration && editing?.session === draft.session && mounted)
      EditorView = view.default;
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
      updatedAt: (draftClock = Math.max(Date.now(), draftClock + 1))
    };
  }
  function persist(): Promise<void> {
    const value = snapshot(),
      s = admitted;
    if (!value || !s) return Promise.resolve();
    const run = ++draftSerial;
    draftStatus = 'Saving draft…';
    draftError = false;
    const pending = draftQueue.catch(() => undefined).then(() => saveDraft(value, s.guard));
    draftQueue = pending;
    void pending
      .then(() => {
        if (editing?.session === value.session && run === draftSerial) {
          draftStatus = 'Draft saved on this device';
          draftError = false;
        }
      })
      .catch((reason) => {
        if (editing?.session === value.session && run === draftSerial) {
          draftStatus = 'Draft could not be saved';
          draftError = true;
          error = report(reason);
        }
      });
    return pending;
  }
  function changedContent(value: TextNode) {
    content = value;
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
    current = undefined;
  }
  async function edit(mode: 'edit' | 'append' = 'edit') {
    if (!current) return;
    const s = scope(),
      item = await refreshSnippet(current.document.id, s);
    s.guard();
    if (!item || item.transfer || item.conflicts.length)
      throw new Error('Finish the move or resolve conflicting versions before editing.');
    current = item;
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
      pickerPurpose = 'save';
      pickerOpen = true;
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
    editing = undefined;
    instance = undefined;
    notice = 'Saved. Cloud changes will finish when the destination is available.';
    try {
      await deleteDraft(draft.key, s.guard);
    } catch {
      notice = 'Saved, but draft cleanup could not finish. The saved document is safe.';
    }
    storedDrafts = await drafts(s.owner);
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
    editing = undefined;
    instance = undefined;
    storedDrafts = await drafts(s.owner);
    s.guard();
    await goto(resolve(libraryPath(target)));
  }
  async function paste(format: 'auto' | 'text' | 'markdown' = 'auto') {
    const s = scope();
    const editor = await import('./editor');
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
      notice = `Restored ${count} snippets on this device. Select them and use Move to choose a connected storage home.`;
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
          notice = 'A different version was imported. Both versions are kept until you choose one.';
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
    const { importContent } = await import('./editor');
    s.guard();
    await newSnippet(
      importContent(
        raw,
        /\.md$/i.test(file.name) ? 'markdown' : /\.html?$/i.test(file.name) ? 'html' : 'text'
      )
    );
  }
  function move(ids: string[]) {
    moving = ids.map((id) => {
      const item = $snippetItems.find((d) => d.id === id);
      if (!item) throw new Error('A selected snippet is missing.');
      return { id, revision: item.revision };
    });
    pickerPurpose = 'move';
    pickerOpen = true;
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
      notice = failures.length
        ? `${failures.length} move(s) need attention. Verified copies and originals were kept.`
        : 'Moved without changing document identities or collections.';
      if (failures.length) error = failures.join('\n');
    } else if (pickerPurpose === 'default') {
      await rememberDestination(value, s);
      notice = value
        ? 'Default snippet location updated.'
        : 'Default cleared. New snippets use the only writable source or ask when there are several.';
    } else {
      destination = value;
      locationChosen = true;
      await persist();
    }
    if (remember && pickerPurpose !== 'default') await rememberDestination(value, s);
    pickerOpen = false;
    await loadRecord(false);
  }
  function membership(ids: string[]) {
    collectionTargets = ids.map(snippetKey);
    newCollection = '';
    collectionsOpen = true;
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
    newCollection = '';
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
    deleteOpen = false;
    selected = new Set();
    notice = failures.length ? failures.join('\n') : 'Moved to Trash. Restore remains available.';
    await loadRecord(false);
  }
  async function chooseVersion(doc: SnippetDocument) {
    if (!current || !admitted) return;
    await resolveConflict(current.document.id, doc, current.document.revision, admitted);
    await loadRecord(false);
    void flushSnippets(admitted).catch(() => undefined);
  }
  function selection(ids: string[]) {
    selected = new Set(ids);
    if (ids.length) selecting = true;
  }
  function resetTransientAccountState() {
    editing = undefined;
    instance = undefined;
    current = undefined;
    content = plainContent('');
    title = '';
    destination = undefined;
    locationChosen = false;
    storedDrafts = [];
    draftQueue = Promise.resolve();
    draftClock = 0;
    draftSerial++;
    selected = new Set();
    selecting = false;
    visibleIds = [];
    source = '';
    pickerOpen = false;
    pickerWriteBusy = false;
    moving = [];
    collectionsOpen = false;
    collectionTargets = [];
    newCollection = '';
    deleteOpen = false;
    deleteIds = [];
    leaveOpen = false;
    leaveTarget = '';
    transferIssue = '';
    draftStatus = '';
    draftError = false;
    annotationPending = false;
    recordSignature = '';
    notice = '';
    error = '';
  }
  function updateQuery() {
    void goto(resolve(libraryPath(listURL({ q: query }))), {
      replaceState: true,
      noScroll: true,
      keepFocus: true
    });
  }
  beforeNavigate((navigation) => {
    if (!editing || !navigation.to) return;
    if (navigation.willUnload) {
      navigation.cancel();
      return;
    }
    navigation.cancel();
    leaveTarget = navigation.to.url.pathname + navigation.to.url.search + navigation.to.url.hash;
    leaveOpen = true;
  });
  async function leave(discard: boolean) {
    if (!discard && annotationPending)
      throw new Error('Apply or cancel the furigana or link first.');
    const target = leaveTarget;
    if (discard) {
      await draftQueue.catch(() => undefined);
      if (editing && admitted) await deleteDraft(editing.key, admitted.guard);
    } else await persist();
    editing = undefined;
    instance = undefined;
    leaveOpen = false;
    await goto(resolve(libraryPath(target)));
  }
  onMount(() => {
    mounted = true;
    let stopped = false;
    const onAccount = () => {
      try {
        const s = scope();
        if (owner === s.owner) return;
        owner = s.owner;
        admitted = s;
        routeGeneration++;
        resetTransientAccountState();
        collectionStop();
        collectionStop = watchOrganization((reason) => {
          if (!stopped) error = report(reason);
        });
        routeLoads.reset();
        void reloadSnippets(s).catch(() => undefined);
      } catch {
        routeLoads.reset();
        routeGeneration++;
        owner = '';
        admitted = undefined;
        resetTransientAccountState();
      }
    };
    const stopA = account.subscribe(onAccount),
      stopB = localUser.subscribe(onAccount);
    return () => {
      stopped = true;
      routeLoads.reset();
      mounted = false;
      routeGeneration++;
      stopA();
      stopB();
      collectionStop();
    };
  });
</script>

<svelte:head
  ><title>{current ? displayTitle(current.document) + ' — ' : ''}Snippets · Manabi Reader</title
  ></svelte:head
>
<div class="snippet-workspace">
  <header class="top">
    <a class="brand" href={resolve('/manage')}>Manabi Reader</a><AppNav />
  </header>
  {#if error}<div class="message error" role="alert">
      {error}<Button variant="ghost" size="sm" onclick={() => (error = '')}>Dismiss</Button>
    </div>{/if}
  {#if notice}<p class="message" role="status">{notice}</p>{/if}
  {#if editing}
    <section
      class="editing"
      aria-label={editing.mode === 'append' ? 'Add text to snippet' : 'Snippet editor'}
    >
      <div class="heading">
        <div>
          <p class="eyebrow">
            {editing.mode === 'append'
              ? 'ADD TO SNIPPET'
              : editing.base
                ? 'EDIT SNIPPET'
                : 'NEW SNIPPET'}
          </p>
          <h1>
            {editing.mode === 'append'
              ? current
                ? displayTitle(current.document)
                : 'Add text'
              : 'Your words, ready to read.'}
          </h1>
        </div>
        <div class="actions">
          <Button
            variant="ghost"
            disabled={busy || annotationPending}
            onclick={() => action(() => closeEditor(false))}>Keep draft</Button
          ><Button
            variant="ghost"
            disabled={busy}
            onclick={() => {
              leaveTarget = editorReturn();
              leaveOpen = true;
            }}>Cancel</Button
          ><Button disabled={busy || !EditorView || annotationPending} onclick={() => action(save)}
            >{editing.mode === 'append' ? 'Append text' : 'Save snippet'}</Button
          >
        </div>
      </div>
      {#if editing.mode !== 'append'}<label class="title-label"
          >Title <span>Optional · leave empty for an automatic title</span><Input
            class="title-input min-h-11"
            aria-label="Snippet title"
            bind:value={title}
            placeholder={automaticTitle}
            maxlength={1000}
            disabled={busy}
            oninput={(event) => {
              title = event.currentTarget.value;
              void persist();
            }}
          /></label
        >{/if}
      {#key renderGeneration}{#if EditorView}<svelte:component
            this={EditorView}
            {content}
            disabled={busy}
            onchange={changedContent}
            onpendingchange={(pending) => (annotationPending = pending)}
            onready={(editor) => {
              instance = editor;
            }}
          />{:else}<p role="status">Loading editor…</p>{/if}{/key}
      <div class="draft-footer">
        <p role="status" class:error={draftError}>{draftStatus}</p>
        {#if editing.mode !== 'append'}<Button
            variant="ghost"
            disabled={busy || !!editing.base}
            onclick={() => {
              pickerPurpose = 'save';
              pickerOpen = true;
            }}
            >{destination
              ? `Save to: ${providerName(destination.source.provider)} › ${destination.source.name} › ${destination.parent || 'Root'}`
              : locationChosen
                ? 'Save on this device only'
                : 'Choose storage location…'}</Button
          >{/if}
      </div>
      {#if editing.base && editing.mode === 'edit'}<p class="muted">
          Changing storage for an existing document uses Move after saving. Cancel does not change
          the saved snippet.
        </p>{/if}
      {#if editing.base}<Button
          variant="ghost"
          disabled={busy}
          onclick={() =>
            action(async () => {
              await persist();
              const draft = snapshot();
              if (draft) await newSnippet(content, draft.document);
            })}>Make this draft a new snippet…</Button
        >{/if}
      {#if draftError}<Button
          variant="secondary"
          onclick={() =>
            action(async () => {
              const draft = snapshot();
              if (draft) {
                download('Recovered snippet.manabi-snippet.json', encodeSnippet(draft.document));
              }
            })}>Export unsaved draft</Button
        >{/if}
    </section>
  {:else if current && admitted}
    <section class="reading" aria-label="Snippet reader">
      <Button
        class="back min-h-11 px-0"
        href={resolve(libraryPath(params.get('returnTo')))}
        variant="link"
        size="sm">← Back to library</Button
      >
      <div class="heading">
        <div>
          <p class="eyebrow">{current.document.trashedAt ? 'IN TRASH' : 'SNIPPET'}</p>
          <h1>{displayTitle(current.document)}</h1>
          <p class="muted" role="status">{saveLabel(current)}</p>
        </div>
        <div class="actions">
          {#if current.document.trashedAt}<Button
              disabled={busy}
              onclick={() =>
                action(async () => {
                  await trashSnippet(current!.document.id, true, admitted);
                  await loadRecord(false);
                })}>Restore snippet</Button
            >{:else}<Button
              disabled={busy || !!current.transfer || !!current.conflicts.length}
              onclick={() => action(() => edit())}>Edit</Button
            ><Button
              variant="secondary"
              disabled={busy || !!current.transfer || !!current.conflicts.length}
              onclick={() => action(() => edit('append'))}>Add text</Button
            >{/if}
        </div>
      </div>
      {#if current.issue}<p class="message" role="status">{current.issue}</p>{/if}
      {#if current.transfer}<div class="message">
          <p>
            {transferIssue ||
              'A move is pending. Original and verified destination copies are preserved.'}
          </p>
          <div class="actions">
            <Button
              disabled={busy}
              onclick={() =>
                action(async () => {
                  await resumeTransfer(current!.document.id, admitted);
                  await loadRecord(false);
                })}>Resume move</Button
            ><Button
              variant="secondary"
              disabled={busy}
              onclick={() =>
                action(async () => {
                  await keepBoth(current!.document.id, admitted);
                  await loadRecord(false);
                })}>Keep both / cancel before copying</Button
            >
          </div>
        </div>{/if}
      {#if current.conflicts.length}<section class="conflicts" aria-label="Conflicting versions">
          <h2>Choose the version to keep editing</h2>
          <p>Other source files are not deleted. Export any version before resolving.</p>
          {#each [current.document, ...current.conflicts] as version, index (`${version.revision}:${index}`)}<details
            >
              <summary
                >{index === 0 ? 'This device' : 'Other version'} · {new Date(
                  version.modifiedAt
                ).toLocaleString()}</summary
              >
              <p>
                {passages(version.content)
                  .map((p) => p.text)
                  .join('\n')}
              </p>
              <Button disabled={busy} onclick={() => action(() => chooseVersion(version))}
                >Use this version</Button
              ><Button
                variant="ghost"
                disabled={busy}
                onclick={() =>
                  action(async () => {
                    download(filename(version), encodeSnippet(version));
                  })}>Export version</Button
              >
            </details>{/each}
        </section>{/if}
      <div class="actions secondary">
        <Button
          variant="ghost"
          disabled={busy || !!current.transfer}
          onclick={() => membership([current!.document.id])}>Collections…</Button
        ><Button
          variant="ghost"
          disabled={busy || !!current.transfer || !!current.conflicts.length}
          onclick={() => move([current!.document.id])}>Move to…</Button
        ><Button
          variant="ghost"
          disabled={busy}
          onclick={() => action(() => newSnippet(current!.document.content, current!.document))}
          >Duplicate</Button
        ><Button
          variant="ghost"
          disabled={busy}
          onclick={() => action(() => exportSnippets([current!.document.id], admitted))}
          >Export JSON</Button
        ><Button
          variant="ghost"
          disabled={busy}
          onclick={() => action(() => exportSnippets([current!.document.id], admitted, 'html'))}
          >HTML</Button
        ><Button
          variant="ghost"
          disabled={busy}
          onclick={() => action(() => exportSnippets([current!.document.id], admitted, 'markdown'))}
          >Markdown</Button
        >{#if !current.document.trashedAt}<Button
            variant="ghost"
            disabled={busy || !!current.transfer}
            onclick={() => {
              deleteIds = [current!.document.id];
              deleteOpen = true;
            }}>Trash</Button
          >{/if}
      </div>
      {#if current.destination}<details class="locations">
          <summary>Storage location{current.locations.length > 1 ? 's' : ''}</summary
          >{#each current.locations as location (JSON.stringify( [location.source.id, location.source.root, location.fileId] ))}<p
            >
              {providerName(location.source.provider)} › {location.source.name} › {location.parent ||
                'Root'} › {location.name}{location.missing ? ' · missing' : ''}
            </p>{/each}{#if !current.locations.length}<p>
              Pending: {providerName(current.destination.source.provider)} › {current.destination
                .parent || 'Root'}
            </p>{/if}
        </details>{/if}
      {#key current.document.id + current.document.revision}<Reader
          document={current.document}
          selectedScope={admitted}
          locator={locator ?? current.progress}
          followRemotePosition={!locator}
        />{/key}
      {#if current.document.source}<p class="source">
          Captured from {current.document.source.title}{#if sourceSnippetId}
            · <a href={resolve(`/snippets?id=${sourceSnippetId}`)}>Open source</a
            >{:else if current.document.source.url}
            · <a
              href={current.document.source.url}
              target="_blank"
              rel="external noopener noreferrer">Open source</a
            >{/if}
        </p>{/if}
    </section>
  {:else}
    <section class="library" aria-label="Snippets library">
      <div class="heading">
        <div>
          <p class="eyebrow">YOUR LIBRARY</p>
          <h1>{trashed ? 'Snippet Trash' : (collection?.name ?? 'Snippets')}</h1>
          <p class="muted">Short texts, together across your connected storage.</p>
        </div>
        <div class="actions">
          <Button disabled={busy || !admitted} onclick={() => action(() => newSnippet())}
            >New snippet</Button
          ><Button
            variant="secondary"
            disabled={busy || !admitted}
            onclick={() => action(() => paste())}>Paste</Button
          >
        </div>
      </div>
      {#if id && !current}<p class="message" role="status">
          This snippet is not available in the current account yet. Refresh connected sources or
          return to the list.
        </p>{/if}
      <div class="search-row">
        <label class="search-label"
          ><span class="sr-only">Search snippets</span><Input
            class="min-h-11 w-full px-4 text-base"
            type="search"
            aria-label="Search snippets"
            placeholder="Search titles and content"
            aria-invalid={snippetSearchTooLong(query) ? true : undefined}
            aria-describedby={snippetSearchTooLong(query)
              ? 'snippet-search-limit-error'
              : undefined}
            bind:value={query}
            oninput={(event) => {
              query = event.currentTarget.value;
              updateQuery();
            }}
          /></label
        >
        <div class="actions" role="group" aria-label="Search scope">
          <Button variant="secondary" aria-pressed={true}>Snippets</Button><Button
            variant="ghost"
            href={`${base}/manage?${new URLSearchParams({ q: query, scope: 'all' })}`}
            >All Library</Button
          >
        </div>
      </div>
      <div class="filters">
        <label
          >Location<select aria-label="Snippet source" bind:value={source}
            ><option value="">All sources</option><option value="device">On this device only</option
            >{#each sources as [key, name] (key)}<option value={key}>{name}</option>{/each}</select
          ></label
        ><label
          >Sort<select aria-label="Sort snippets" bind:value={sort}
            ><option value="edited">Last edited</option><option value="read">Recently read</option
            ><option value="created">Date created</option><option value="title">Title</option
            ></select
          ></label
        ><label
          >View<select aria-label="Snippet view" bind:value={layout}
            ><option value="list">List</option><option value="grid">Cards</option></select
          ></label
        ><Button
          variant="ghost"
          disabled={busy}
          onclick={() => {
            selecting = !selecting;
            selected = new Set();
          }}>{selecting ? 'Done selecting' : 'Select'}</Button
        ><Button
          variant="ghost"
          disabled={busy || !admitted}
          onclick={() => action(() => refreshSnippets(admitted, true))}>Refresh sources</Button
        ><Button variant="ghost" href={listURL({ trash: trashed ? '' : '1' })}
          >{trashed ? 'All snippets' : 'Trash'}</Button
        >
      </div>
      {#if $snippetStatus.busy || $snippetStatus.remaining}<p role="status">
          Indexing connected snippets… {$snippetStatus.remaining} remaining. Already indexed text is
          searchable.
        </p>{/if}
      {#if $snippetStatus.issues.length}<details>
          <summary>Source notices ({$snippetStatus.issues.length})</summary
          >{#each $snippetStatus.issues as problem, index (index)}<p class="muted">
              {problem}
            </p>{/each}
        </details>{/if}
      {#if selecting}<div class="batch" role="toolbar" aria-label="Selected snippet actions">
          <strong>{selected.size} selected</strong><Button
            variant="secondary"
            onclick={() => (selected = new Set(visibleIds))}>Select all visible</Button
          ><Button
            variant="ghost"
            disabled={!selected.size || busy}
            onclick={() => membership([...selected])}>Collections…</Button
          ><Button
            variant="ghost"
            disabled={!selected.size || busy}
            onclick={() => move([...selected])}>Move to…</Button
          ><Button
            variant="ghost"
            disabled={!selected.size || busy}
            onclick={() => action(() => exportSnippets([...selected], admitted))}
            >Export selected</Button
          >{#if trashed}<Button
              variant="ghost"
              disabled={!selected.size || busy}
              onclick={() =>
                action(async () => {
                  for (const id of selected) await trashSnippet(id, true, admitted);
                  selected = new Set();
                })}>Restore</Button
            >{:else}<Button
              variant="ghost"
              disabled={!selected.size || busy}
              onclick={() => {
                deleteIds = [...selected];
                deleteOpen = true;
              }}>Move to Trash</Button
            >{/if}
        </div>{/if}
      <Shelf
        {query}
        {source}
        {layout}
        {sort}
        {trashed}
        members={collection?.members}
        {selecting}
        {selected}
        onselect={selection}
        onvisible={(ids) => {
          visibleIds = ids;
          selected = new Set([...selected].filter((id) => ids.includes(id)));
        }}
        returnTo={routeURL}
      />
      {#if storedDrafts.length}<section class="drafts" aria-label="Recovered snippet drafts">
          <h2>Continue a draft</h2>
          <p class="muted">Drafts stay on this device and are not included in library search.</p>
          {#each storedDrafts as draft (draft.key)}<div class="draft">
              <a href={resolve(`/snippets?draft=${draft.session}`)}
                >{displayTitle(draft.document)}
                <span>· {draft.mode ?? 'new'} · {new Date(draft.updatedAt).toLocaleString()}</span
                ></a
              ><Button
                variant="ghost"
                disabled={busy}
                onclick={() =>
                  action(async () => {
                    if (!admitted) return;
                    await deleteDraft(draft.key, admitted.guard);
                    storedDrafts = await drafts(admitted.owner);
                  })}>Discard draft</Button
              >
            </div>{/each}
        </section>{/if}
      <footer class="actions library-footer">
        <input
          class="sr-only"
          type="file"
          accept=".manabi-snippet.json,.manabi-snippets.json,.txt,.md,.html,.htm"
          bind:this={importInput}
          onchange={() => {
            const file = importInput.files?.[0];
            importInput.value = '';
            if (file) void action(() => importFile(file));
          }}
        /><Button variant="ghost" disabled={busy || !admitted} onclick={() => importInput.click()}
          >Import text or backup…</Button
        ><Button
          variant="ghost"
          disabled={busy || !admitted}
          onclick={() => action(() => paste('markdown'))}>Paste as Markdown</Button
        ><Button
          variant="ghost"
          disabled={busy || !admitted}
          onclick={() => {
            pickerPurpose = 'default';
            pickerOpen = true;
          }}>Default save location…</Button
        ><Button href={resolve('/connections')} variant="link" size="sm" class="min-h-11 px-0"
          >Manage connected libraries</Button
        >
      </footer>
    </section>
  {/if}
</div>
{#if pickerOpen && admitted}<Dialog.Root bind:open={pickerOpen}
    ><Dialog.Content class="overflow-hidden p-0" closeDisabled={busy || pickerWriteBusy}
      ><div
        data-snippet-picker-scroll
        class="max-h-[inherit] min-h-0 overflow-y-auto overscroll-contain p-[24px]"
      >
        <Dialog.Header class="pe-[48px]"
          ><Dialog.Title
            >{pickerPurpose === 'move'
              ? 'Move snippets'
              : pickerPurpose === 'default'
                ? 'Default snippet location'
                : 'Save location'}</Dialog.Title
          ><Dialog.Description
            >Choose one real storage home. Your documents remain together in the Snippets view.</Dialog.Description
          ></Dialog.Header
        ><DestinationPicker
          initial={destination ?? current?.destination}
          guard={admitted.guard}
          allowDevice={pickerPurpose === 'save'}
          allowUnsetDefault={pickerPurpose === 'default'}
          onwritebusy={(value) => (pickerWriteBusy = value)}
          choose={(value, remember) => void action(() => chooseDestination(value, remember))}
        />
      </div></Dialog.Content
    >
  </Dialog.Root>
{/if}
{#if collectionsOpen}<Dialog.Root bind:open={collectionsOpen}
    ><Dialog.Content closeDisabled={busy}
      ><Dialog.Header
        ><Dialog.Title>Add to collections</Dialog.Title><Dialog.Description
          >Collection membership does not move the underlying files.</Dialog.Description
        ></Dialog.Header
      >{#each $organization.collections as collection (collection.id)}<label class="membership"
          ><input
            class="size-5 accent-primary"
            type="checkbox"
            checked={collectionTargets.every((id) => collection.members.includes(id))}
            disabled={busy}
            onchange={(event) =>
              void action(() => toggleCollection(collection.id, event.currentTarget.checked))}
          />{collection.name}</label
        >{/each}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void action(addCollection);
        }}
      >
        <label
          >New collection<Input
            class="min-h-11"
            aria-label="New collection name"
            bind:value={newCollection}
            maxlength={240}
          /></label
        ><Button type="submit" disabled={busy || !newCollection.trim()}>Create collection</Button>
      </form>
      <Button variant="secondary" disabled={busy} onclick={() => (collectionsOpen = false)}
        >Done</Button
      ></Dialog.Content
    ></Dialog.Root
  >{/if}
{#if deleteOpen}<Dialog.Root bind:open={deleteOpen}
    ><Dialog.Content closeDisabled={busy}
      ><Dialog.Header
        ><Dialog.Title
          >Move {deleteIds.length} snippet{deleteIds.length === 1 ? '' : 's'} to Trash?</Dialog.Title
        ><Dialog.Description
          >This saves a recoverable trash state in each document. Collections and other copies are
          not deleted.</Dialog.Description
        ></Dialog.Header
      ><Button variant="destructive" disabled={busy} onclick={() => action(removeSelected)}
        >Move to Trash</Button
      ><Button variant="ghost" disabled={busy} onclick={() => (deleteOpen = false)}>Cancel</Button
      ></Dialog.Content
    ></Dialog.Root
  >{/if}
{#if leaveOpen}<Dialog.Root bind:open={leaveOpen}
    ><Dialog.Content closeDisabled={busy}
      ><Dialog.Header
        ><Dialog.Title>Keep this draft?</Dialog.Title><Dialog.Description
          >The saved snippet has not changed. Keep the draft on this device or discard these edits.</Dialog.Description
        ></Dialog.Header
      ><Button disabled={busy || annotationPending} onclick={() => action(() => leave(false))}
        >Keep draft and leave</Button
      ><Button variant="destructive" disabled={busy} onclick={() => action(() => leave(true))}
        >Discard draft and leave</Button
      ><Button variant="ghost" disabled={busy} onclick={() => (leaveOpen = false)}
        >Continue editing</Button
      ></Dialog.Content
    ></Dialog.Root
  >{/if}

<style>
  .snippet-workspace {
    max-width: 88rem;
    margin: auto;
    padding: 1rem clamp(1rem, 3vw, 3rem) 5rem;
    color: var(--foreground);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0 2rem;
  }
  .brand {
    min-width: 0;
    font-weight: 700;
    font-size: 1.1rem;
    overflow-wrap: anywhere;
  }
  .heading {
    display: flex;
    justify-content: space-between;
    gap: 1.5rem;
    align-items: center;
    margin: 1.5rem 0;
  }
  h1 {
    font-size: clamp(1.7rem, 3vw, 2.5rem);
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  h2 {
    font-size: 1.15rem;
    font-weight: 650;
  }
  .eyebrow {
    font-size: 0.7rem;
    font-weight: 650;
    letter-spacing: 0.12em;
    color: var(--muted-foreground);
    margin-bottom: 0.45rem;
  }
  .muted {
    color: var(--muted-foreground);
    font-size: 0.88rem;
    line-height: 1.7;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .secondary {
    padding: 0.6rem 0;
  }
  .reading,
  .editing {
    max-width: 62rem;
    margin: auto;
  }
  .search-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin: 1.5rem 0;
  }
  .search-label {
    flex: 1;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
    margin-bottom: 1.2rem;
  }
  .filters label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--muted-foreground);
  }
  select {
    min-height: 44px;
    border: 1px solid var(--input);
    border-radius: 10px;
    background: var(--background);
    color: var(--foreground);
    padding: 0.55rem 0.7rem;
    min-width: 0;
  }
  select:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .message {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    background: var(--muted);
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    margin: 0.8rem 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .error {
    border-inline-start: 3px solid var(--destructive);
  }
  .snippet-workspace :global(.back) {
    color: var(--muted-foreground);
    font-size: 0.85rem;
  }
  .title-label {
    display: grid;
    gap: 0.4rem;
    font-weight: 600;
    margin: 1rem 0;
  }
  .title-label span {
    font-size: 0.78rem;
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .snippet-workspace :global(.title-input) {
    font-size: 1.3rem;
    font-weight: 500;
    width: 100%;
  }
  .draft-footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.78rem;
    color: var(--muted-foreground);
    border-top: 1px solid var(--border);
    padding-top: 0.7rem;
  }
  .drafts {
    margin-top: 2rem;
    padding-top: 1.3rem;
    border-top: 1px solid var(--border);
  }
  .draft {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0;
  }
  .draft span {
    font-size: 0.8rem;
    color: var(--muted-foreground);
  }
  .batch {
    position: sticky;
    top: 0.4rem;
    max-height: min(50dvh, 24rem);
    overflow-y: auto;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding: 0.7rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    margin-bottom: 0.9rem;
    box-shadow: 0 2px 8px #0001;
  }
  .batch strong {
    font-size: 0.85rem;
    margin-inline-end: 0.5rem;
  }
  .library-footer {
    margin-top: 2rem;
    color: var(--muted-foreground);
    font-size: 0.85rem;
  }
  .locations {
    font-size: 0.78rem;
    color: var(--muted-foreground);
    padding: 0.7rem 0;
    overflow-wrap: anywhere;
  }
  .locations p {
    margin: 0.4rem 0;
  }
  .source {
    font-size: 0.85rem;
    color: var(--muted-foreground);
    border-top: 1px solid var(--border);
    padding: 1rem 0;
  }
  .conflicts {
    padding: 1rem;
    background: var(--muted);
    border-radius: 0.8rem;
  }
  .conflicts details {
    padding: 0.7rem 0;
  }
  .conflicts details p {
    white-space: pre-wrap;
    max-height: 12rem;
    overflow: auto;
    line-height: 1.8;
    margin: 0.5rem 0;
  }
  .membership {
    display: flex;
    min-height: 44px;
    gap: 0.6rem;
    align-items: center;
    cursor: pointer;
  }
  form {
    display: grid;
    gap: 0.6rem;
  }
  form label {
    display: grid;
    gap: 0.4rem;
  }
  @media (max-width: 640px) {
    .heading {
      align-items: start;
      flex-direction: column;
    }
    .search-row {
      align-items: stretch;
      flex-direction: column;
    }
    .snippet-workspace {
      padding-inline: 1rem;
    }
    .top {
      padding-bottom: 0.5rem;
    }
    .draft {
      align-items: start;
      flex-direction: column;
    }
    .filters {
      gap: 0.5rem;
    }
    .filters label {
      flex: 1 1 10rem;
      min-width: 0;
      max-width: 100%;
    }
    .filters select {
      width: 100%;
      max-width: 100%;
    }
  }
</style>
