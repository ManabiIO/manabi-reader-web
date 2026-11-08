/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { account, localUser } from '../lib/manabi/client';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { scope, snippetItems, flushSnippets, appendToSnippet } from '../lib/snippets/service';
import { saveDraft, deleteDraft, recordKey } from '../lib/snippets/database';
import {
  createSnippet,
  passages,
  truncateValidText,
  type SnippetDocument,
  type TextNode
} from '../lib/snippets/document';
import { ReaderController, type StoreValue } from '../reader-react/controller';

export type CaptureProps = Record<string, unknown>;

export function createCapture(
  props: CaptureProps,
  _emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let choices: StoreValue<typeof snippetItems>;
  let $snippetItems: StoreValue<typeof snippetItems> = __readerController.read(snippetItems);
  let open = false,
    busy = false,
    error = '',
    status = '',
    deferredCount = 0,
    query = '';
  let content: TextNode | undefined,
    document: SnippetDocument | undefined,
    session = '',
    captured: ReturnType<typeof scope> | undefined;
  let presentationScope: ReturnType<typeof scope> | undefined;
  let presentationGeneration = 0;
  function canPresent(selected: ReturnType<typeof scope> | undefined, generation: number) {
    if (__readerController.disposed || generation !== presentationGeneration) return false;
    try {
      selected?.guard();
      return true;
    } catch {
      return false;
    }
  }
  __readerController.effect(
    () => [$snippetItems],
    () => {
      __readerController.changed(
        (choices = $snippetItems.filter(
          (item) => !item.trashedAt && !item.transfer && !item.conflicts
        ))
      );
    }
  );
  async function create() {
    if (!captured || !content || !document || busy || __readerController.disposed) return;
    const selected = captured, captureSession = session, generation = presentationGeneration;
    __readerController.changed((busy = true));
    try {
      selected.guard();
      __readerController.changed((open = false));
      await goto(resolve(`/snippets?draft=${encodeURIComponent(captureSession)}`));
    } catch (reason) {
      if (canPresent(selected, generation)) __readerController.changed(
        (error =
          reason instanceof Error ? reason.message : 'The capture remains in recovered drafts.')
      );
    } finally {
      if (canPresent(selected, generation)) __readerController.changed((busy = false));
    }
  }
  async function append(id: string) {
    if (!captured || !content || busy || __readerController.disposed) return;
    const selected = captured, text = content, captureSession = session,
      generation = presentationGeneration;
    const key = recordKey(selected.owner, captureSession);
    __readerController.changed((busy = true));
    __readerController.changed((error = ''));
    try {
      await appendToSnippet(id, text, captureSession, selected);
    } catch (reason) {
      if (canPresent(selected, generation)) {
        __readerController.changed((error = reason instanceof Error ? reason.message : 'The capture is preserved as a draft.'));
        __readerController.changed((busy = false));
      }
      return;
    }
    // The durable append receipt already committed. Cleanup cannot make it retryable.
    try {
      await deleteDraft(key, selected.guard);
    } catch {
      try { selected.guard(); } catch {
        if (canPresent(selected, generation)) __readerController.changed((busy = false));
        return;
      }
      if (canPresent(selected, generation)) __readerController.changed((status =
        "Added to snippet. Its saved capture draft could not be cleaned up and remains recoverable."));
    }
    if (canPresent(selected, generation)) {
      __readerController.changed((open = false));
      __readerController.changed((busy = false));
    }
    void flushSnippets(selected).catch(() => undefined);
  }
  async function persistCapture(event: Event, selected: ReturnType<typeof scope>) {
    const value = (event as CustomEvent<unknown>).detail;
    if (!value || typeof value !== 'object') throw new Error('The captured selection is invalid.');
    const payload = value as { html: unknown; title: unknown; item: unknown; owner: unknown };
    if (typeof payload.html !== 'string' || typeof payload.title !== 'string' ||
        typeof payload.item !== 'string' || (payload.owner !== null && typeof payload.owner !== 'string'))
      throw new Error('The captured selection is invalid.');
    if (selected.owner !== (payload.owner === null ? 'local' : 'account:' + payload.owner))
      throw new Error('The account changed before capture.');
    const { importContent } = await import('../lib/snippets/editor');
    selected.guard();
    const text = importContent(payload.html, 'html');
    const created = createSnippet(text);
    created.source = {
      title: truncateValidText(payload.title, 1000),
      item: truncateValidText(payload.item, 1000),
      quote: truncateValidText(passages(text).map((passage) => passage.text).join('\n'), 4000)
    };
    const key = crypto.randomUUID();
    await saveDraft({ key: recordKey(selected.owner, key), owner: selected.owner,
      id: created.id, session: key, base: null, document: created,
      updatedAt: Date.now(), mode: 'new' }, selected.guard);
    selected.guard();
    return { selected, text, document: created, session: key };
  }
  __readerController.onMount(() => {
    let alive = true;
    const receive = async (event: Event) => {
      if (!alive || __readerController.disposed) return;
      const deferred = open || busy;
      const generation = deferred ? presentationGeneration : ++presentationGeneration;
      let selected: ReturnType<typeof scope> | undefined;
      if (!deferred) {
        presentationScope = undefined;
        __readerController.changed((busy = true));
        __readerController.changed((query = ''));
        __readerController.changed((error = ''));
        __readerController.changed((status = ''));
        deferredCount = 0;
      }
      try {
        selected = scope();
        if (!deferred) presentationScope = selected;
        // Each deliberate capture is durable even while another action owns the dialog.
        const saved = await persistCapture(event, selected);
        if (!alive || !canPresent(saved.selected, generation)) return;
        if (deferred) {
          deferredCount++;
          __readerController.changed((status = deferredCount + ' additional selection' +
            (deferredCount === 1 ? '' : 's') + ' saved for later.'));
          return;
        }
        __readerController.changed((captured = saved.selected));
        __readerController.changed((content = saved.text));
        __readerController.changed((document = saved.document));
        __readerController.changed((session = saved.session));
        __readerController.changed((open = true));
      } catch (reason) {
        if (alive && canPresent(selected, generation)) __readerController.changed((error =
          reason instanceof Error ? reason.message : 'The selection could not be captured.'));
      } finally {
        if (!deferred && alive && canPresent(selected, generation)) __readerController.changed((busy = false));
      }
    };
    const clearStalePresentation = () => {
      try {
        presentationScope?.guard();
        captured?.guard();
      } catch {
        presentationGeneration++;
        presentationScope = undefined;
        __readerController.changed((busy = false));
        __readerController.changed((open = false));
        __readerController.changed((content = undefined));
        __readerController.changed((document = undefined));
        __readerController.changed((captured = undefined));
        __readerController.changed((query = ''));
        __readerController.changed((error = ''));
        __readerController.changed((status = ''));
        deferredCount = 0;
      }
    };
    const stopAccount = localUser.subscribe(clearStalePresentation);
    const stopTransport = account.subscribe(clearStalePresentation);
    window.addEventListener('manabi-capture-snippet', receive);
    return () => {
      alive = false;
      presentationGeneration++;
      presentationScope = undefined;
      stopAccount();
      stopTransport();
      window.removeEventListener('manabi-capture-snippet', receive);
    };
  });
  __readerController.observeSource(
    () => snippetItems,
    (value) => {
      $snippetItems = value;
    }
  );
  const api = {
    controller: __readerController,
    create,
    append,
    get status() { return status; },
    dismissStatus() {
      __readerController.changed((error = ''));
      __readerController.changed((status = ''));
      deferredCount = 0;
    },
    get open() {
      return open;
    },
    set open(nextValue: typeof open) {
      if (Object.is(open, nextValue)) return;
      open = nextValue;
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
    get error() {
      return error;
    },
    set error(nextValue: typeof error) {
      if (Object.is(error, nextValue)) return;
      error = nextValue;
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
    get content() {
      return content;
    },
    set content(nextValue: typeof content) {
      if (Object.is(content, nextValue)) return;
      content = nextValue;
      __readerController.invalidate();
    },
    get document() {
      return document;
    },
    set document(nextValue: typeof document) {
      if (Object.is(document, nextValue)) return;
      document = nextValue;
      __readerController.invalidate();
    },
    get session() {
      return session;
    },
    set session(nextValue: typeof session) {
      if (Object.is(session, nextValue)) return;
      session = nextValue;
      __readerController.invalidate();
    },
    get captured() {
      return captured;
    },
    set captured(nextValue: typeof captured) {
      if (Object.is(captured, nextValue)) return;
      captured = nextValue;
      __readerController.invalidate();
    },
    get choices() {
      return choices;
    },
    set choices(nextValue: typeof choices) {
      if (Object.is(choices, nextValue)) return;
      choices = nextValue;
      __readerController.invalidate();
    },
    get $snippetItems() {
      return $snippetItems;
    },
    updateProps(_next: Record<string, unknown>) {}
  };
  return api;
}
