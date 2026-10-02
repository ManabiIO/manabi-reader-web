/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { localUser } from '../lib/manabi/client';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { scope, snippetItems, flushSnippets, appendToSnippet } from '../lib/snippets/service';
import { saveDraft, deleteDraft, recordKey } from '../lib/snippets/database';
import {
  createSnippet,
  passages,
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
    query = '';
  let content: TextNode | undefined,
    document: SnippetDocument | undefined,
    session = '',
    captured: ReturnType<typeof scope> | undefined;
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
    if (!captured || !content || !document || busy) return;
    __readerController.changed((busy = true));
    try {
      captured.guard();
      __readerController.changed((open = false));
      await goto(resolve(`/snippets?draft=${encodeURIComponent(session)}`));
    } catch (reason) {
      __readerController.changed(
        (error =
          reason instanceof Error ? reason.message : 'The capture remains in recovered drafts.')
      );
    } finally {
      __readerController.changed((busy = false));
    }
  }
  async function append(id: string) {
    if (!captured || !content || busy) return;
    __readerController.changed((busy = true));
    __readerController.changed((error = ''));
    try {
      const selected = captured,
        text = content;
      await appendToSnippet(id, text, session, selected);
      await deleteDraft(recordKey(selected.owner, session), selected.guard);
      __readerController.changed((open = false));
      void flushSnippets(selected).catch(() => undefined);
    } catch (reason) {
      __readerController.changed(
        (error = reason instanceof Error ? reason.message : 'The capture is preserved as a draft.')
      );
    } finally {
      __readerController.changed((busy = false));
    }
  }
  __readerController.onMount(() => {
    let alive = true;
    const receive = async (event: Event) => {
      if (open || busy) return;
      __readerController.changed((busy = true));
      const value = (
        event as CustomEvent<{
          html: string;
          title: string;
          item: string;
          owner: string | null;
        }>
      ).detail;
      try {
        const selected = scope();
        if (selected.owner !== (value.owner ? `account:${value.owner}` : 'local'))
          throw new Error('The account changed before capture.');
        const { importContent } = await import('../lib/snippets/editor');
        selected.guard();
        const text = importContent(value.html, 'html');
        const created = createSnippet(text);
        created.source = {
          title: value.title.slice(0, 1000),
          item: value.item.slice(0, 1000),
          quote: passages(text)
            .map((p) => p.text)
            .join('\n')
            .slice(0, 4000)
        };
        const key = crypto.randomUUID();
        await saveDraft(
          {
            key: recordKey(selected.owner, key),
            owner: selected.owner,
            id: created.id,
            session: key,
            base: null,
            document: created,
            updatedAt: Date.now(),
            mode: 'new'
          },
          selected.guard
        );
        selected.guard();
        if (!alive) return;
        __readerController.changed((captured = selected));
        __readerController.changed((content = text));
        __readerController.changed((document = created));
        __readerController.changed((session = key));
        __readerController.changed((query = ''));
        __readerController.changed((error = ''));
        __readerController.changed((open = true));
      } catch (reason) {
        __readerController.changed(
          (error =
            reason instanceof Error ? reason.message : 'The selection could not be captured.')
        );
      } finally {
        __readerController.changed((busy = false));
      }
    };
    const stopAccount = localUser.subscribe(() => {
      try {
        captured?.guard();
      } catch {
        __readerController.changed((open = false));
        __readerController.changed((content = undefined));
        __readerController.changed((document = undefined));
        __readerController.changed((captured = undefined));
        __readerController.changed((query = ''));
        __readerController.changed((error = ''));
      }
    });
    window.addEventListener('manabi-capture-snippet', receive);
    return () => {
      alive = false;
      stopAccount();
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
