/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  canonical,
  createSnippet,
  displayTitle,
  type SnippetDocument
} from '../lib/snippets/document';
import type { Destination, SnippetDraft, SnippetRecord } from '../lib/snippets/database';
import type { SnippetSummary } from '../lib/snippets/summary';
import type { SourceDescriptor } from '../lib/library/catalog';
import { applyNativePatch, nativeRuns, parsePatch } from './editor-model';
import type {
  NativeSnippetEditor,
  NativeSnippetResult,
  NativeSnippetsState,
  SnippetAuthority
} from './contract';
export interface NativeSnippetData {
  owner: string;
  items: SnippetSummary[];
  drafts: SnippetDraft[];
  sources: { source: SourceDescriptor; writable: boolean; reason?: string }[];
}
export interface NativeSnippetsRepository {
  load(authority: SnippetAuthority): Promise<NativeSnippetData>;
  read(id: string, authority: SnippetAuthority): Promise<SnippetRecord | undefined>;
  search(
    query: string,
    items: SnippetSummary[],
    authority: SnippetAuthority
  ): Promise<{ ids: Set<string>; complete: boolean }>;
  checkpoint(draft: SnippetDraft, authority: SnippetAuthority): Promise<void>;
  discard(draft: SnippetDraft, authority: SnippetAuthority): Promise<void>;
  save(draft: SnippetDraft, authority: SnippetAuthority): Promise<void>;
  trash(id: string, revision: string, restore: boolean, authority: SnippetAuthority): Promise<void>;
  folders(
    destination: Destination,
    authority: SnippetAuthority
  ): Promise<{ id: string; name: string }[]>;
}
interface Admission {
  authority: string;
  created: number;
  items: Map<string, { id: string; revision: string }>;
  drafts: Map<string, { session: string; revision: string }>;
  editor?: SnippetDraft;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const opaque = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
export class NativeSnippetsService {
  private scope = '';
  private generation = 0;
  private busy = false;
  private clock = 0;
  private admissions = new Map<string, Admission>();
  private handles = new Map<string, string>();
  private destinations = new Map<string, { value: Destination; name: string; writable: boolean }>();
  private receipts = new Map<string, { fingerprint: string; result: NativeSnippetResult }>();
  constructor(
    private repository: NativeSnippetsRepository,
    private token = () => crypto.randomUUID(),
    private now = () => Date.now()
  ) {}
  private bind(authority: SnippetAuthority) {
    authority.signal.throwIfAborted();
    authority.assertCurrent();
    if (this.scope !== authority.key) {
      this.dispose();
      this.scope = authority.key;
    }
    const generation = this.generation;
    return () => {
      authority.signal.throwIfAborted();
      authority.assertCurrent();
      if (generation !== this.generation || authority.key !== this.scope)
        throw new Error('The snippet account or reader session changed.');
    };
  }
  private handle(value: string) {
    for (const [key, target] of this.handles) if (target === value) return key;
    if (this.handles.size >= 10000) throw new Error('Too many snippet handles. Reopen the screen.');
    const key = this.token();
    this.handles.set(key, value);
    return key;
  }
  private destination(value: Destination, name: string, writable: boolean) {
    const key = this.handle(`destination:${canonical([value.source, value.parent])}`);
    this.destinations.set(key, {
      value: { source: structuredClone(value.source), parent: value.parent },
      name,
      writable
    });
    return key;
  }
  private admit(authority: SnippetAuthority, data: Partial<Admission>) {
    const token = this.token();
    this.admissions.set(token, {
      authority: authority.key,
      created: this.now(),
      items: new Map(),
      drafts: new Map(),
      ...data
    });
    while (this.admissions.size > 24) this.admissions.delete(this.admissions.keys().next().value!);
    return token;
  }
  private admission(token: string, authority: SnippetAuthority) {
    const entry = this.admissions.get(token);
    if (
      !entry ||
      entry.authority !== authority.key ||
      this.now() - entry.created < 0 ||
      this.now() - entry.created > 30 * 60 * 1000
    )
      throw new Error('This snippet view expired. Refresh or reopen the saved draft.');
    return entry;
  }
  private editor(
    draft: SnippetDraft,
    authority: SnippetAuthority,
    conflict = false
  ): NativeSnippetEditor {
    const runs = nativeRuns(draft.document);
    const key = this.handle(`draft:${draft.session}`);
    return {
      key,
      token: this.admit(authority, { editor: structuredClone(draft) }),
      title: draft.document.title.mode === 'custom' ? draft.document.title.text : '',
      runs,
      source: { title: draft.document.source?.title ?? '', url: draft.document.source?.url ?? '' },
      destination: draft.destination ? draft.destination.source.name : 'This device',
      ...(draft.destination
        ? {
            destinationKey: this.destination(draft.destination, draft.destination.source.name, true)
          }
        : {}),
      canChooseDestination: draft.base === null,
      hasConflict: conflict,
      notice:
        'Text, furigana and source edits preserve existing headings, lists, links and formatting. New paragraphs can be appended. Layout and formatting tools remain available in the web editor.'
    };
  }
  private updated(draft: SnippetDraft) {
    return { ...draft, updatedAt: (this.clock = Math.max(this.now(), this.clock + 1)) };
  }
  async state(payload: unknown, authority: SnippetAuthority): Promise<NativeSnippetsState> {
    const check = this.bind(authority);
    // Fence the repository's transaction-time guard against service disposal as well as account changes.
    authority = { key: authority.key, signal: authority.signal, assertCurrent: check };
    if (
      !object(payload) ||
      Object.keys(payload).some((key) => !['query', 'trash', 'source', 'page'].includes(key)) ||
      (payload.query !== undefined &&
        (typeof payload.query !== 'string' || [...payload.query].length > 512)) ||
      (payload.trash !== undefined && typeof payload.trash !== 'boolean') ||
      (payload.source !== undefined && !opaque(payload.source)) ||
      (payload.page !== undefined &&
        (!Number.isSafeInteger(payload.page) ||
          Number(payload.page) < 0 ||
          Number(payload.page) > 10000))
    )
      throw new Error('Invalid snippets query.');
    const query = structuredClone(payload);
    const data = await this.repository.load(authority);
    check();
    const sources = data.sources.slice(0, 200).map(({ source, writable, reason }) => ({
      key: this.destination({ source, parent: source.root }, source.name, writable),
      name: source.name,
      provider: source.provider,
      writable,
      reason
    }));
    const source = query.source ? this.destinations.get(String(query.source)) : undefined;
    if (query.source && !source) throw new Error('The selected source expired.');
    let entries = data.items.filter(
      (item) =>
        !!item.trashedAt === !!query.trash &&
        (!source ||
          [item.destination?.source, ...item.locations.map((location) => location.source)].some(
            (value) => value && canonical(value) === canonical(source.value.source)
          ))
    );
    let complete = true;
    if (typeof query.query === 'string' && query.query.trim()) {
      const found = await this.repository.search(query.query.trim(), entries, authority);
      check();
      entries = entries.filter((item) => found.ids.has(item.id));
      complete = found.complete;
    }
    entries.sort((a, b) => b.modifiedAt - a.modifiedAt || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(entries.length / 40));
    const page = Math.min(Number(query.page ?? 0), pages - 1);
    const admitted = new Map<string, { id: string; revision: string }>();
    const items = entries.slice(page * 40, page * 40 + 40).map((item) => {
      const key = this.handle(`item:${item.id}`);
      admitted.set(key, { id: item.id, revision: item.revision });
      return {
        key,
        title: item.title,
        excerpt: item.excerpt,
        modifiedAt: item.modifiedAt,
        trashed: !!item.trashedAt,
        pending: item.dirty || item.progressDirty,
        conflicts: item.conflicts,
        issue: item.issue,
        destination: item.destination?.source.name ?? 'This device'
      };
    });
    const drafts = new Map<string, { session: string; revision: string }>();
    const draftRows = data.drafts
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100)
      .map((draft) => {
        const key = this.handle(`draft:${draft.session}`);
        drafts.set(key, { session: draft.session, revision: draft.document.revision });
        return { key, title: displayTitle(draft.document), updatedAt: draft.updatedAt };
      });
    check();
    const response = {
      token: this.admit(authority, { items: admitted, drafts }),
      items,
      total: entries.length,
      page,
      pages,
      sources,
      drafts: draftRows,
      searchComplete: complete,
      notices: [
        ...(!complete
          ? [
              'Search reached its safe local scan limit. Narrow the source or search on web for all results.'
            ]
          : []),
        ...(data.drafts.length > 100 ? ['Showing the 100 most recently changed drafts.'] : []),
        ...(data.sources.length > 200 ? ['Showing the first 200 sources.'] : [])
      ]
    };
    if (new TextEncoder().encode(JSON.stringify(response)).length > 640 * 1024)
      throw new Error('This snippets view is too large. Use a narrower search or source.');
    return response;
  }
  async action(payload: unknown, authority: SnippetAuthority): Promise<NativeSnippetResult> {
    const check = this.bind(authority);
    // Fence the repository's transaction-time guard against service disposal as well as account changes.
    authority = { key: authority.key, signal: authority.signal, assertCurrent: check };
    if (
      !object(payload) ||
      !opaque(payload.token) ||
      typeof payload.type !== 'string' ||
      ![
        'new',
        'edit',
        'resume',
        'duplicate',
        'trash',
        'restore',
        'read',
        'checkpoint',
        'save',
        'save-copy',
        'discard',
        'browse'
      ].includes(payload.type) ||
      Object.keys(payload).some(
        (key) =>
          ![
            'type',
            'token',
            ...(payload.type === 'new' ? [] : ['key']),
            ...(['checkpoint', 'save', 'save-copy'].includes(String(payload.type)) ? ['patch'] : [])
          ].includes(key)
      ) ||
      (payload.type !== 'new' && !opaque(payload.key))
    )
      throw new Error('Invalid snippets action.');
    const action = structuredClone(payload);
    const token = String(action.token);
    const fingerprint = canonical(action);
    const receipt = this.receipts.get(token);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new Error('This snippet operation was already used. Refresh first.');
      return structuredClone(receipt.result);
    }
    const admitted = this.admission(token, authority);
    if (action.type === 'browse') {
      const target = this.destinations.get(String(action.key));
      if (!target || !target.writable)
        throw new Error('This destination is unavailable or read-only.');
      const children = await this.repository.folders(target.value, authority);
      check();
      return {
        folders: {
          destinationKey: String(action.key),
          name: target.name,
          folders: children.slice(0, 500).map((folder) => ({
            key: this.destination(
              { source: target.value.source, parent: folder.id },
              folder.name,
              true
            ),
            name: folder.name
          }))
        }
      };
    }
    if (this.busy)
      throw new Error('Another snippet change is in progress. Wait before trying again.');
    const patch = ['checkpoint', 'save', 'save-copy'].includes(String(action.type))
      ? parsePatch(action.patch)
      : undefined;
    this.busy = true;
    this.admissions.delete(token);
    try {
      let result: NativeSnippetResult = {};
      if (action.type === 'new') {
        const data = await this.repository.load(authority);
        check();
        const session = this.token();
        const document = createSnippet();
        const draft = this.updated({
          key: JSON.stringify([data.owner, session]),
          owner: data.owner,
          session,
          id: document.id,
          base: null,
          document,
          updatedAt: 0,
          mode: 'new'
        });
        await this.repository.checkpoint(draft, authority);
        check();
        result.editor = this.editor(draft, authority);
      } else if (action.type === 'resume') {
        const target = admitted.drafts.get(String(action.key));
        if (!target) throw new Error('This draft is outside the current view.');
        const data = await this.repository.load(authority);
        check();
        const original = data.drafts.find((draft) => draft.session === target.session);
        if (!original || original.document.revision !== target.revision)
          throw new Error('This saved draft changed. Refresh before reopening it.');
        nativeRuns(original.document);
        const session = this.token();
        const draft = this.updated({
          ...structuredClone(original),
          key: JSON.stringify([original.owner, session]),
          session
        });
        // New editing lease prevents an older screen from overwriting the resumed draft.
        await this.repository.checkpoint(draft, authority);
        check();
        await this.repository.discard(original, authority);
        check();
        const current = await this.repository.read(draft.id, authority);
        check();
        result.editor = this.editor(
          draft,
          authority,
          (current?.document.revision ?? null) !== draft.base
        );
      } else if (['checkpoint', 'save', 'save-copy', 'discard'].includes(String(action.type))) {
        const original = admitted.editor;
        if (!original || this.handles.get(String(action.key)) !== `draft:${original.session}`)
          throw new Error('This draft is outside the current editor.');
        if (action.type === 'discard') {
          await this.repository.discard(original, authority);
          check();
          result.saved = true;
        } else {
          let draft = this.updated({
            ...structuredClone(original),
            document: applyNativePatch(original.document, patch!)
          });
          if (patch!.destinationKey !== undefined) {
            if (draft.base !== null)
              throw new Error('Moving an existing snippet requires the web transfer workflow.');
            const destination =
              patch!.destinationKey === null
                ? undefined
                : this.destinations.get(patch!.destinationKey);
            if (patch!.destinationKey !== null && (!destination || !destination.writable))
              throw new Error('The save destination is unavailable or read-only.');
            draft.destination = destination?.value;
          }
          if (action.type === 'save-copy') {
            const document = createSnippet(
              draft.document.content,
              draft.document.title.mode === 'custom' ? draft.document.title.text : ''
            );
            document.source = draft.document.source;
            draft = { ...draft, document, id: document.id, base: null, mode: 'new' };
          }
          await this.repository.checkpoint(draft, authority);
          check();
          if (action.type === 'checkpoint') result.editor = this.editor(draft, authority);
          else {
            try {
              await this.repository.save(draft, authority);
              check();
              result.saved = true;
            } catch (error) {
              check();
              result.editor = this.editor(draft, authority, true);
              result.editor.notice =
                error instanceof Error
                  ? error.message
                  : 'Your draft is safe. Refresh or save a copy.';
            }
          }
        }
      } else {
        const target = admitted.items.get(String(action.key));
        if (!target) throw new Error('This snippet is outside the current view.');
        const record = await this.repository.read(target.id, authority);
        check();
        if (!record || record.document.revision !== target.revision)
          throw new Error('This snippet changed. Refresh before continuing.');
        if (action.type === 'read') {
          result.readerId = record.document.id;
          result.readerRevision = record.document.revision;
        } else if (action.type === 'trash' || action.type === 'restore') {
          await this.repository.trash(
            target.id,
            target.revision,
            action.type === 'restore',
            authority
          );
          check();
          result.saved = true;
        } else {
          if (
            action.type === 'edit' &&
            (record.transfer || record.conflicts.length || record.document.trashedAt)
          )
            throw new Error(
              'Resolve the pending move or conflict on web before editing. You can duplicate the retained version.'
            );
          const document: SnippetDocument =
            action.type === 'duplicate'
              ? createSnippet(
                  record.document.content,
                  record.document.title.mode === 'custom' ? record.document.title.text : ''
                )
              : structuredClone(record.document);
          if (action.type === 'duplicate')
            document.source = structuredClone(record.document.source);
          nativeRuns(document);
          const session = this.token();
          const draft = this.updated({
            key: JSON.stringify([record.owner, session]),
            owner: record.owner,
            session,
            id: document.id,
            base: action.type === 'duplicate' ? null : document.revision,
            document,
            destination: action.type === 'duplicate' ? undefined : record.destination,
            updatedAt: 0,
            mode: action.type === 'duplicate' ? 'new' : 'edit'
          });
          await this.repository.checkpoint(draft, authority);
          check();
          result.editor = this.editor(draft, authority);
        }
      }
      check();
      this.receipts.set(token, { fingerprint, result: structuredClone(result) });
      while (this.receipts.size > 64) this.receipts.delete(this.receipts.keys().next().value!);
      return result;
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.generation++;
    this.admissions.clear();
    this.destinations.clear();
    this.handles.clear();
    this.receipts.clear();
    this.scope = '';
  }
}
