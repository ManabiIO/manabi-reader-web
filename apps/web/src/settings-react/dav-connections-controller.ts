/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { WebDavClient } from '../lib/webdav/client';
import {
  configureDav,
  davSources,
  type DavConfiguration,
  type WebDavSource
} from '../lib/webdav/source';
import { ReaderController } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

export interface DavConnectionsProps {
  onbrowse: (source: WebDavSource) => Promise<void>;
  onchange: (id: string) => Promise<void>;
}

export function createDavConnections(
  props: DavConnectionsProps,
  _emit: (name: string, detail?: unknown) => void = () => {},
  _componentContext: SettingsContextValue
) {
  const __readerController = new ReaderController();
  let existing: any;

  let onbrowse: (source: WebDavSource) => Promise<void> = props.onbrowse;
  let onchange: (id: string) => Promise<void> = props.onchange;
  let sources: DavConfiguration[] = [];
  let editing: string | null = null;
  let expectedConfiguration: DavConfiguration | null = null;
  let name = '',
    url = '',
    username = '',
    password = '';
  let remember = false,
    writable = false,
    busy = false,
    message = '',
    mounted = false;
  let operationController: AbortController | undefined;
  __readerController.effect(
    () => [sources, editing],
    () => {
      __readerController.changed((existing = sources.some((source) => source.id === editing)));
    }
  );
  function edit(source?: DavConfiguration) {
    operationController?.abort();
    __readerController.changed((expectedConfiguration = source ? { ...source } : null));
    __readerController.changed((editing = source?.id ?? `webdav-${crypto.randomUUID()}`));
    __readerController.changed((name = source?.name ?? ''));
    __readerController.changed((url = source?.url ?? ''));
    __readerController.changed((username = source?.username ?? ''));
    __readerController.changed((password = source?.password ?? ''));
    __readerController.changed((remember = source?.password !== undefined));
    __readerController.changed((writable = source?.writable ?? false));
    __readerController.changed((message = ''));
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    __readerController.changed((busy = true));
    __readerController.changed((message = ''));
    try {
      await work();
    } catch (error) {
      if (mounted && !(error instanceof DOMException && error.name === 'AbortError'))
        __readerController.changed(
          (message =
            error instanceof Error ? error.message : 'WebDAV could not complete this operation.')
        );
    } finally {
      if (mounted) __readerController.changed((busy = false));
    }
  }
  async function save() {
    if (!editing) return;
    const config = { id: editing, name: name.trim(), url: url.trim(), username, writable };
    const secret = password,
      persist = remember,
      expected = expectedConfiguration;
    operationController?.abort();
    const active = __readerController.changed((operationController = new AbortController()));
    // A connection test is read-only; saving never creates a folder or uploads data.
    await new WebDavClient(config.url, config.username, secret, active.signal).list();
    active.signal.throwIfAborted();
    if (!mounted) return;
    await configureDav(config, secret, { remember: persist, expected, signal: active.signal });
    await onchange(config.id);
    if (!mounted) return;
    __readerController.changed((sources = await davSources()));
    __readerController.changed((editing = null));
    __readerController.changed((password = ''));
    __readerController.changed(
      (message =
        'WebDAV connected. Books are read-only; reading-data sync remains a separate choice.')
    );
  }
  __readerController.onMount(() => {
    __readerController.changed((mounted = true));
    void run(async () => {
      __readerController.changed((sources = await davSources()));
    });
    return () => {
      __readerController.changed((mounted = false));
      operationController?.abort();
      __readerController.changed((password = ''));
    };
  });

  const api = {
    controller: __readerController,
    edit,
    run,
    save,
    get onbrowse() {
      return onbrowse;
    },
    set onbrowse(nextValue: typeof onbrowse) {
      if (Object.is(onbrowse, nextValue)) return;
      onbrowse = nextValue;
      __readerController.invalidate();
    },
    get onchange() {
      return onchange;
    },
    set onchange(nextValue: typeof onchange) {
      if (Object.is(onchange, nextValue)) return;
      onchange = nextValue;
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
    get editing() {
      return editing;
    },
    set editing(nextValue: typeof editing) {
      if (Object.is(editing, nextValue)) return;
      editing = nextValue;
      __readerController.invalidate();
    },
    get expectedConfiguration() {
      return expectedConfiguration;
    },
    set expectedConfiguration(nextValue: typeof expectedConfiguration) {
      if (Object.is(expectedConfiguration, nextValue)) return;
      expectedConfiguration = nextValue;
      __readerController.invalidate();
    },
    get name() {
      return name;
    },
    set name(nextValue: typeof name) {
      if (Object.is(name, nextValue)) return;
      name = nextValue;
      __readerController.invalidate();
    },
    get url() {
      return url;
    },
    set url(nextValue: typeof url) {
      if (Object.is(url, nextValue)) return;
      url = nextValue;
      __readerController.invalidate();
    },
    get username() {
      return username;
    },
    set username(nextValue: typeof username) {
      if (Object.is(username, nextValue)) return;
      username = nextValue;
      __readerController.invalidate();
    },
    get password() {
      return password;
    },
    set password(nextValue: typeof password) {
      if (Object.is(password, nextValue)) return;
      password = nextValue;
      __readerController.invalidate();
    },
    get remember() {
      return remember;
    },
    set remember(nextValue: typeof remember) {
      if (Object.is(remember, nextValue)) return;
      remember = nextValue;
      __readerController.invalidate();
    },
    get writable() {
      return writable;
    },
    set writable(nextValue: typeof writable) {
      if (Object.is(writable, nextValue)) return;
      writable = nextValue;
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
    get message() {
      return message;
    },
    set message(nextValue: typeof message) {
      if (Object.is(message, nextValue)) return;
      message = nextValue;
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
    get operationController() {
      return operationController;
    },
    set operationController(nextValue: typeof operationController) {
      if (Object.is(operationController, nextValue)) return;
      operationController = nextValue;
      __readerController.invalidate();
    },
    get existing() {
      return existing;
    },
    set existing(nextValue: typeof existing) {
      if (Object.is(existing, nextValue)) return;
      existing = nextValue;
      __readerController.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if ('onbrowse' in next) api.onbrowse = next.onbrowse as typeof onbrowse;
      if ('onchange' in next) api.onchange = next.onchange as typeof onchange;
    }
  };
  return api;
}
