/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { RouteBack } from '../shared-ui/RouteBack.web';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Head,
  Button,
  AppNav,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createConnectionsScreen,
  type ConnectionsScreenProps
} from './connections-screen-controller';
import { setDavBookSync } from '$lib/webdav/sync';
import { WebDavSource } from '$lib/webdav/source';

import { resolve } from '$app/paths';
import {
  refreshAccount,
  connectProvider,
  signOut,
  providerLabels,
  accountGeneration,
  localProfileUser
} from '$lib/manabi/client';
import { enablePreferenceSync, syncPreferences } from '$lib/manabi/preferences';
import {
  refreshLinkedBooks,
  importLibraryBook,
  syncBook,
  syncAllLinkedBooks
} from '$lib/manabi/books';
import { resolvePersonalConflict } from '$lib/manabi/personal-sync';

import { removeLocalLibrary, supportedBook } from '$lib/manabi/sources';

import { DavConnections } from './dav-connections';
/** Keep an unfinished numeric edit separate from the persisted reader setting.
 * A cleared/invalid input must not publish the store's default back into itself. */
function FontSizeInput({
  value,
  onValueChange
}: {
  value: number;
  onValueChange(value: number): void;
}) {
  const [edit, setEdit] = React.useState({ saved: value, text: String(value) });
  // A real external preference update owns the field. Unrelated account renders
  // retain its draft, without a delayed effect replacing the next user edit.
  const text = edit.saved === value ? edit.text : String(value);
  if (edit.saved !== value) setEdit({ saved: value, text });
  return (
    <input
      type="number"
      min={8}
      max={96}
      step={1}
      required
      value={text}
      onChange={(event) => {
        const input = event.currentTarget;
        setEdit({ saved: value, text: input.value });
        if (input.validity.valid) onValueChange(input.valueAsNumber);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.validity.valid) setEdit({ saved: value, text: String(value) });
      }}
    />
  );
}
export function ConnectionsScreen(
  props: Partial<ConnectionsScreenProps> &
    ReaderViewProps & {
      children?: React.ReactNode;
      onClose?: () => void;
      slot?: string;
    }
) {
  const latest = useLatest(props);
  const context = useSettingsContext();
  const c = useReaderController(
    () =>
      createConnectionsScreen(
        props as ConnectionsScreenProps,
        (name, detail) => {
          latest.current.events?.[name]?.({ detail });
          if (name === 'close') latest.current.onClose?.();
        },
        context
      ),
    props
  );
  const [preferenceChange, setPreferenceChange] = React.useState<{
    owner: NonNullable<typeof c>;
    user: string;
    enabled: boolean;
  } | null>(null);
  const [davChange, setDavChange] = React.useState<{
    owner: NonNullable<typeof c>;
    linkId: string;
    profileId: string | null;
    generation: number;
    enabled: boolean;
  } | null>(null);
  useReaderBindings(c, props);
  if (!c) return null;
  const changingPreferences =
    preferenceChange?.owner === c && preferenceChange.user === c.$account.session?.user?.id
      ? preferenceChange
      : null;
  const changingDav =
    davChange?.owner === c &&
    davChange.profileId === (localProfileUser()?.id ?? null) &&
    davChange.generation === accountGeneration()
      ? davChange
      : null;
  return (
    <SettingsContext.Provider value={context}>
      <div className="react-settings-connections-screen" style={{ display: 'contents' }}>
        <Dom
          as="header"
          className={[
            'app-header flex min-h-14 items-center justify-between border-b border-border bg-card px-3'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <RouteBack fallback="/manage" />
          <AppNav></AppNav>
        </Dom>
        <Head>
          <Dom as="title">{'Accounts and libraries · Manabi Reader'}</Dom>
        </Head>
        <Dom as="main" className={['connections-page'].filter(Boolean).join(' ')}>
          <Dom as="header">
            <Dom as="h1">{'Accounts and libraries'}</Dom>
            <Dom as="p">{'Read locally. Connect only the services you choose.'}</Dom>
          </Dom>
          {c.message ? (
            <>
              <Dom as="p" role={'status'} className={['notice'].filter(Boolean).join(' ')}>
                {c.message}
              </Dom>
            </>
          ) : null}
          <Dom as="section" aria-labelledby={'account-heading'}>
            <Dom as="h2" id={'account-heading'}>
              {'Manabi account'}
            </Dom>
            {c.$account.session?.user ? (
              <>
                <Dom as="p">
                  {'Signed in as '}
                  <Dom as="strong">{c.$account.session.user.username}</Dom>
                  {'.'}
                </Dom>
                <Dom
                  as="button"
                  disabled={c.busy}
                  events={{
                    click: () =>
                      c.action(async () => {
                        await signOut();
                        await c.reload();
                      })
                  }}
                >
                  {'Sign out'}
                </Dom>
                <Dom as="div" className={['preference-controls'].filter(Boolean).join(' ')}>
                  <Dom as="label">
                    <Dom
                      as="input"
                      type={'checkbox'}
                      checked={changingPreferences?.enabled ?? c.$preferenceStatus.enabled}
                      disabled={c.busy}
                      events={{
                        change: (event: Event & { currentTarget: HTMLInputElement }) => {
                          const user = c.$account.session?.user?.id;
                          if (c.busy || !user) return;
                          const change = { owner: c, user, enabled: event.currentTarget.checked };
                          // React requires the controlled choice during this event. The
                          // durable preference status is published only after storage
                          // commits; keep that pending choice local to this account.
                          setPreferenceChange(change);
                          void c
                            .action(() => enablePreferenceSync(change.enabled, c.preferenceChoice))
                            .finally(() =>
                              setPreferenceChange((current) =>
                                current === change ? null : current
                              )
                            );
                        }
                      }}
                    />
                    {' Sync reader settings with this Manabi account'}
                  </Dom>
                  {!c.$preferenceStatus.enabled ? (
                    <>
                      <Dom as="label">
                        {'When first enabling sync '}
                        <Dom
                          as="select"
                          value={c.preferenceChoice}
                          bindings={{
                            value: (value: typeof c.preferenceChoice) => {
                              c.controller.changed((c.preferenceChoice = value));
                            }
                          }}
                        >
                          <Dom as="option" value={'remote'}>
                            {'Use account settings when they exist'}
                          </Dom>
                          <Dom as="option" value={'local'}>
                            {'Use this device’s settings'}
                          </Dom>
                        </Dom>
                      </Dom>
                    </>
                  ) : null}
                  <Dom as="p" role={'status'} aria-label={'Settings sync status'}>
                    {' Settings sync: '}
                    {c.$preferenceStatus.state === 'synced-local-metadata'
                      ? 'synced (book metadata saved locally)'
                      : c.$preferenceStatus.state}
                  </Dom>
                  {c.$preferenceStatus.state === 'synced-local-metadata' ? (
                    <>
                      <Dom as="p">
                        {
                          ' This server does not yet support syncing edited book metadata, personal series or cover blur. Those edits remain saved in this browser and will sync automatically when the server supports them. Other settings and collections are synced. '
                        }
                      </Dom>
                    </>
                  ) : null}
                  {c.$preferenceStatus.state === 'conflict' ? (
                    <>
                      <Dom as="p">
                        {'These preferences changed in both places: '}
                        {c.$preferenceStatus.conflicts.join(', ')}
                        {'.'}
                      </Dom>
                      <Dom
                        as="button"
                        disabled={c.busy}
                        events={{ click: () => c.action(() => syncPreferences('local')) }}
                      >
                        {'Keep this device’s settings'}
                      </Dom>
                      <Dom
                        as="button"
                        disabled={c.busy}
                        events={{ click: () => c.action(() => syncPreferences('remote')) }}
                      >
                        {'Use account settings'}
                      </Dom>
                    </>
                  ) : (
                    <>
                      {' '}
                      {c.$preferenceStatus.enabled ? (
                        <>
                          <Dom
                            as="button"
                            disabled={c.busy}
                            events={{ click: () => c.action(() => syncPreferences()) }}
                          >
                            {'Sync settings now'}
                          </Dom>
                        </>
                      ) : null}
                    </>
                  )}
                  <Dom as="div" className={['quick-settings'].filter(Boolean).join(' ')}>
                    <Dom as="label">
                      {'Font size'}
                      <FontSizeInput
                        value={c.$fontSize$}
                        onValueChange={(value) => {
                          c.controller.changed((c.$fontSize$ = value));
                        }}
                      />
                    </Dom>
                    <Dom as="label">
                      {'Writing direction'}
                      <Dom
                        as="select"
                        value={c.$writingMode$}
                        bindings={{
                          value: (value: typeof c.$writingMode$) => {
                            c.controller.changed((c.$writingMode$ = value));
                          }
                        }}
                      >
                        <Dom as="option" value={'vertical-rl'}>
                          {'Vertical'}
                        </Dom>
                        <Dom as="option" value={'horizontal-tb'}>
                          {'Horizontal'}
                        </Dom>
                      </Dom>
                    </Dom>
                  </Dom>
                  <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
                    {
                      ' Settings sync does not upload your books, local folder handles, fonts, or cloud credentials. '
                    }
                  </Dom>
                </Dom>
              </>
            ) : (
              <>
                {' '}
                <Dom as="p">
                  {
                    'An account is optional. Sign in to sync your preferences and connect cloud libraries.'
                  }
                </Dom>
                <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                  <Button
                    href={'/accounts/login/?next=' + String(c.connectionReturn ?? '')}
                    rel={'external'}
                    variant={'default'}
                    size={'lg'}
                  >
                    {'Sign in to Manabi'}
                  </Button>
                  <Button
                    href={'/accounts/signup/?next=' + String(c.connectionReturn ?? '')}
                    rel={'external'}
                    variant={'outline'}
                    size={'lg'}
                  >
                    {'Create a Manabi account'}
                  </Button>
                </Dom>
              </>
            )}
            {c.$account.status === 'offline' ? (
              <>
                <Dom as="p">{'You are offline. Local reading remains available.'}</Dom>
              </>
            ) : null}
            {c.$account.status === 'unavailable' ? (
              <>
                <Dom as="p">
                  {
                    ' Manabi account services are not available on this deployment. Local libraries still work. '
                  }
                </Dom>
              </>
            ) : null}
            <Button
              variant={'ghost'}
              disabled={c.busy}
              onClick={() =>
                c.action(async () => {
                  await refreshAccount(true);
                  await c.reload();
                })
              }
            >
              {'Refresh connections'}
            </Button>
          </Dom>
          <Dom as="section" aria-labelledby={'cloud-heading'}>
            <Dom as="h2" id={'cloud-heading'}>
              {'Cloud libraries'}
            </Dom>
            <Dom as="p">
              {
                ' Connect your storage account once, then select the book folders Manabi may use. No developer application setup is needed. '
              }
            </Dom>
            {c.$account.session?.user ? (
              <>
                <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                  {(c.$account.session.providers ?? []).map((provider, _index0) => (
                    <React.Fragment key={provider}>
                      <Dom
                        as="button"
                        disabled={c.busy}
                        events={{ click: () => c.action(() => connectProvider(provider)) }}
                      >
                        {'Connect '}
                        {providerLabels[provider] ?? provider}
                      </Dom>
                    </React.Fragment>
                  ))}
                </Dom>
                {!c.$account.session.providers.length ? (
                  <>
                    <Dom as="p">
                      {' Cloud providers have not been enabled by this deployment’s operator yet. '}
                    </Dom>
                  </>
                ) : null}
                {(c.connections ?? []).map((connection, _index1) => (
                  <React.Fragment key={connection.id}>
                    <Dom
                      as="article"
                      aria-label={
                        String(providerLabels[connection.provider] ?? connection.provider ?? '') +
                        ' connection'
                      }
                      className={['library'].filter(Boolean).join(' ')}
                    >
                      <Dom as="h3">
                        {providerLabels[connection.provider] ?? connection.provider}
                      </Dom>
                      {connection.needs_reconnect ? (
                        <>
                          <Dom as="p" role={'status'}>
                            {
                              ' This connection needs authorization again. Connect it again before removing this old connection. '
                            }
                          </Dom>
                        </>
                      ) : null}
                      <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                        <Dom
                          as="button"
                          disabled={c.busy}
                          events={{ click: () => c.action(() => c.chooseFolders(connection)) }}
                        >
                          {'Choose folders'}
                        </Dom>
                        <Dom
                          as="button"
                          disabled={c.busy}
                          className={['destructive-action'].filter(Boolean).join(' ')}
                          events={{ click: () => c.action(() => c.disconnect(connection)) }}
                        >
                          {'Disconnect cloud account'}
                        </Dom>
                      </Dom>
                      {!connection.roots.length ? (
                        <>
                          <Dom as="p">
                            {
                              ' No folders selected. Manabi will not read files from this connection. '
                            }
                          </Dom>
                        </>
                      ) : null}
                      {(connection.roots ?? []).map((root, _index2) => (
                        <React.Fragment key={root}>
                          <Dom
                            as="button"
                            disabled={c.busy}
                            events={{ click: () => c.action(() => c.openCloud(connection, root)) }}
                          >
                            {'Browse selected folder '}
                            {root}
                          </Dom>
                        </React.Fragment>
                      ))}
                    </Dom>
                  </React.Fragment>
                ))}
              </>
            ) : (
              <>
                {' '}
                <Dom as="p">{'Sign in above to connect Google Drive, OneDrive, or Dropbox.'}</Dom>
              </>
            )}
            {c.folderPicker ? (
              <>
                <Dom
                  as="form"
                  aria-label={'Select cloud folders'}
                  events={{
                    submit: (event: Event & { currentTarget: HTMLFormElement }) => {
                      event.preventDefault();
                      Reflect.apply(() => c.action(c.saveFolders), undefined, [event]);
                    }
                  }}
                >
                  <Dom as="h3">{'Folders Manabi may use'}</Dom>
                  <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
                    {
                      ' The provider’s OAuth permission may cover more than these folders. Manabi restricts book access to your selection. '
                    }
                  </Dom>
                  {(c.folderPicker!.folders ?? []).map((folder, _index3) => (
                    <React.Fragment key={folder.id}>
                      <Dom as="label" className={['folder-choice'].filter(Boolean).join(' ')}>
                        <Dom
                          as="input"
                          type={'checkbox'}
                          group={c.folderPicker!.selected}
                          value={folder.id}
                          bindings={{
                            group: (value: string[]) => {
                              c.controller.changed((c.folderPicker!.selected = value));
                            }
                          }}
                        />
                        {folder.name}
                        <Dom as="small">{folder.id}</Dom>
                      </Dom>
                    </React.Fragment>
                  ))}
                  <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                    <Dom as="button" type={'submit'} disabled={c.busy}>
                      {'Save folder access'}
                    </Dom>
                    <Dom
                      as="button"
                      type={'button'}
                      events={{ click: () => c.controller.changed((c.folderPicker = null)) }}
                    >
                      {'Cancel'}
                    </Dom>
                  </Dom>
                </Dom>
              </>
            ) : null}
          </Dom>
          <DavConnections
            onbrowse={c.openDav}
            onchange={async (id) => {
              if (c.source?.id === id) {
                c.controller.changed((c.source = null));
                c.controller.changed((c.entries = []));
                c.navigation++;
              }
              await refreshLinkedBooks();
            }}
          ></DavConnections>
          <Dom as="section" aria-labelledby={'local-heading'}>
            <Dom as="h2" id={'local-heading'}>
              {'Local folders'}
            </Dom>
            <Dom as="p">
              {
                ' Choose a folder already on this device, including locally available iCloud Drive, Dropbox, OneDrive, or Google Drive folders. '
              }
            </Dom>
            {c.nativeFolders ? (
              <>
                <Button variant={'outline'} disabled={c.busy} onClick={c.pickLocal}>
                  {'Add local folder'}
                </Button>
              </>
            ) : (
              <>
                {' '}
                <Dom as="p">
                  {
                    ' Persistent folder access needs a compatible browser, such as desktop Chrome or Edge. You can still '
                  }
                  <Dom as="a" href={resolve('/manage')}>
                    {'import individual books'}
                  </Dom>
                  {'. '}
                </Dom>
              </>
            )}
            {(c.localLibraries ?? []).map((library, _index4) => (
              <React.Fragment key={library.id}>
                <Dom
                  as="article"
                  aria-label={'Local library ' + String(library.name ?? '')}
                  className={['library'].filter(Boolean).join(' ')}
                >
                  <Dom as="h3">{library.name}</Dom>
                  <Dom as="p">
                    {library.writable ? 'Series editing allowed.' : 'Read-only book access.'}
                  </Dom>
                  <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                    <Dom
                      as="button"
                      disabled={c.busy}
                      events={{ click: () => c.action(() => c.openLocal(library)) }}
                    >
                      {'Browse '}
                      {library.name}
                    </Dom>
                    <Dom
                      as="button"
                      disabled={c.busy}
                      events={{ click: () => c.grant(library, false) }}
                    >
                      {'Reconnect folder'}
                    </Dom>
                    <Dom
                      as="button"
                      disabled={c.busy}
                      events={{ click: () => c.grant(library, true) }}
                    >
                      {'Allow series editing'}
                    </Dom>
                    <Dom
                      as="button"
                      disabled={c.busy}
                      className={['destructive-action'].filter(Boolean).join(' ')}
                      events={{
                        click: () =>
                          c.action(async () => {
                            await removeLocalLibrary(library.id);
                            if (c.source?.id === library.id) {
                              c.controller.changed((c.source = null));
                              c.controller.changed((c.entries = []));
                            }
                            await c.reload();
                          })
                      }}
                    >
                      {'Disconnect local folder'}
                    </Dom>
                  </Dom>
                </Dom>
              </React.Fragment>
            ))}
            <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
              {
                ' Reading does not modify original books. Series edits in a writable folder move selected originals and write .manabi-reader.yaml. Personal reading data stays in IndexedDB and syncs through Manabi when signed in. A local folder save does not confirm that your operating system has finished its cloud upload. '
              }
            </Dom>
          </Dom>
          {c.source ? (
            <>
              <Dom as="section" aria-labelledby={'browse-heading'}>
                <Dom as="h2" id={'browse-heading'}>
                  {'Browse '}
                  {c.sourceName}
                </Dom>
                <Dom as="nav" aria-label={'Folder path'}>
                  {(c.trail ?? []).map((part, index) => (
                    <React.Fragment key={part.id}>
                      <Dom
                        as="button"
                        disabled={c.busy}
                        events={{
                          click: () =>
                            c.action(async () => {
                              c.controller.changed((c.trail = c.trail.slice(0, index + 1)));
                              await c.browse(part.id);
                            })
                        }}
                      >
                        {part.name}
                      </Dom>
                    </React.Fragment>
                  ))}
                </Dom>
                <Dom as="p">
                  {c.source instanceof WebDavSource
                    ? 'Import books for offline reading. WebDAV reading-data sync is a separate opt-in action below; original book files are never changed.'
                    : 'Verified books sync personal reading data through your Manabi account. Folder write access is not required.'}
                </Dom>
                {c.source instanceof WebDavSource ? (
                  <>
                    <Dom as="label">
                      {'Upload a new book or ZIP backup '}
                      <Dom
                        as="input"
                        type={'file'}
                        accept={'.epub,.txt,.htmlz,.zip'}
                        disabled={c.busy}
                        events={{ change: c.uploadDav }}
                      />
                    </Dom>
                    <Dom as="p">
                      {
                        ' Selecting a file uploads it to this folder and verifies its bytes. Existing files are never replaced. ZIP backups can be downloaded unchanged for migration. '
                      }
                    </Dom>
                  </>
                ) : null}
                {(c.entries ?? []).map((entry, _index5) => (
                  <React.Fragment key={entry.id}>
                    <Dom as="div" className={['file-entry'].filter(Boolean).join(' ')}>
                      <Dom as="span">
                        {entry.kind === 'folder' ? 'Folder: ' : ''}
                        {entry.name}
                        <Dom as="small">{entry.id}</Dom>
                      </Dom>
                      {entry.kind === 'folder' ? (
                        <>
                          <Dom
                            as="button"
                            disabled={c.busy}
                            events={{ click: () => c.action(() => c.enter(entry)) }}
                          >
                            {'Open folder '}
                            {entry.name}
                          </Dom>
                        </>
                      ) : (
                        <>
                          {' '}
                          {c.source instanceof WebDavSource && /\.zip$/i.test(entry.name) ? (
                            <>
                              <Dom
                                as="button"
                                disabled={c.busy}
                                events={{ click: () => c.downloadDavBackup(entry) }}
                              >
                                {'Download backup '}
                                {entry.name}
                              </Dom>
                            </>
                          ) : (
                            <>
                              {' '}
                              {supportedBook(entry.name) ? (
                                <>
                                  <Dom
                                    as="button"
                                    disabled={c.busy}
                                    events={{
                                      click: () =>
                                        c.action(async () => {
                                          if (!c.source) return;
                                          c.controller.changed(
                                            (c.lastImported = await importLibraryBook(
                                              c.source,
                                              entry,
                                              !(c.source instanceof WebDavSource)
                                            ))
                                          );
                                          c.controller.changed(
                                            (c.message = `Imported ${c.lastImported.title}. It is now available offline.`)
                                          );
                                        })
                                    }}
                                  >
                                    {'Import '}
                                    {entry.name}
                                  </Dom>
                                </>
                              ) : null}
                            </>
                          )}
                        </>
                      )}
                    </Dom>
                  </React.Fragment>
                ))}
                {!c.entries.length ? (
                  <>
                    <Dom as="p">{'No supported books or subfolders here.'}</Dom>
                  </>
                ) : null}
                {c.cursor ? (
                  <>
                    <Dom
                      as="button"
                      disabled={c.busy}
                      events={{
                        click: () => c.action(() => c.browse(c.trail[c.trail.length - 1].id, true))
                      }}
                    >
                      {'Load more files'}
                    </Dom>
                  </>
                ) : null}
                {c.lastImported ? (
                  <>
                    <Dom as="p">
                      <Button href={resolve(`/b?id=${c.lastImported!.bookId}`)} variant={'default'}>
                        {'Read '}
                        {c.lastImported.title}
                      </Button>
                    </Dom>
                  </>
                ) : null}
              </Dom>
            </>
          ) : null}
          <Dom as="section" aria-labelledby={'reading-sync-heading'}>
            <Dom as="h2" id={'reading-sync-heading'}>
              {'Personal reading sync'}
            </Dom>
            <Dom as="p" role={'status'}>
              {c.$personalSyncStatus.message ||
                'Verified books and annotations sync when signed in.'}
            </Dom>
            {(c.$personalSyncStatus.conflicts ?? []).map((conflict, _index6) => (
              <React.Fragment key={conflict.id}>
                <Dom
                  as="article"
                  aria-label={'Sync conflict for ' + String(conflict.bookKey ?? '')}
                  className={['library'].filter(Boolean).join(' ')}
                >
                  <Dom as="h3">
                    {conflict.kind}
                    {' conflict'}
                  </Dom>
                  <Dom as="p">
                    {conflict.bookKey}
                    {' · '}
                    {conflict.fields.join(', ')}
                  </Dom>
                  {conflict.kind === 'annotation' ? (
                    <>
                      <Dom as="p">
                        {'Device note: '}
                        {String(conflict.local?.body ?? '(empty or deleted)')}
                      </Dom>
                      <Dom as="p">
                        {'Account note: '}
                        {String(conflict.remote?.body ?? '(empty or deleted)')}
                      </Dom>
                    </>
                  ) : null}
                  <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                    <Dom
                      as="button"
                      disabled={c.busy}
                      events={{
                        click: () => c.action(() => resolvePersonalConflict(conflict.id, 'local'))
                      }}
                    >
                      {'Keep device copy'}
                    </Dom>
                    <Dom
                      as="button"
                      disabled={c.busy}
                      events={{
                        click: () => c.action(() => resolvePersonalConflict(conflict.id, 'remote'))
                      }}
                    >
                      {'Use account copy'}
                    </Dom>
                  </Dom>
                </Dom>
              </React.Fragment>
            ))}
            <Button
              variant={'secondary'}
              disabled={c.busy}
              onClick={() => c.action(syncAllLinkedBooks)}
            >
              {'Sync personal reading data now'}
            </Button>
            {!c.$linkedBooks.length ? (
              <>
                <Dom as="p">
                  {
                    ' Verified local books and annotations sync through your account even without a linked cloud library. '
                  }
                </Dom>
              </>
            ) : null}
            {(c.$linkedBooks ?? []).map((link, _index7) => (
              <React.Fragment key={link.id}>
                <Dom
                  as="article"
                  aria-label={'Reading sync for ' + String(link.title ?? '')}
                  className={['library'].filter(Boolean).join(' ')}
                >
                  {link.sourceId.startsWith('webdav-') ? (
                    <>
                      <Dom as="label">
                        <Dom
                          as="input"
                          type={'checkbox'}
                          checked={
                            changingDav?.linkId === link.id ? changingDav.enabled : link.syncEnabled
                          }
                          disabled={c.busy}
                          events={{
                            change: (event: Event & { currentTarget: HTMLInputElement }) => {
                              if (c.busy) return;
                              const change = {
                                owner: c,
                                linkId: link.id,
                                profileId: localProfileUser()?.id ?? null,
                                generation: accountGeneration(),
                                enabled: event.currentTarget.checked
                              };
                              // Keep only the visible intent pending. Durable consent
                              // still belongs to the guarded WebDAV transaction.
                              setDavChange(change);
                              void c
                                .action(async () => {
                                  await setDavBookSync(change.linkId, change.enabled);
                                  await refreshLinkedBooks();
                                })
                                .finally(() =>
                                  setDavChange((current) => (current === change ? null : current))
                                );
                            }
                          }}
                        />
                        {' Sync this book’s reading data with WebDAV'}
                      </Dom>
                      <Dom as="p" className={['hint'].filter(Boolean).join(' ')}>
                        {
                          ' No Manabi server is used. Sync runs while the Library is visible, not while reading or after closing the app. Same-field conflicts require a choice. '
                        }
                      </Dom>
                      {c.$davSyncStatus[link.id]?.state === 'conflict' ? (
                        <>
                          <Dom as="p">{c.$davSyncStatus[link.id]?.conflicts?.join(', ')}</Dom>
                          <Dom
                            as="button"
                            disabled={c.busy}
                            events={{ click: () => c.action(() => syncBook(link.id, 'local')) }}
                          >
                            {c.$davSyncStatus[link.id]?.missing
                              ? 'Restore WebDAV file from this device'
                              : 'Keep device conflicts'}
                          </Dom>
                          {!c.$davSyncStatus[link.id]?.missing ? (
                            <>
                              <Dom
                                as="button"
                                disabled={c.busy}
                                events={{
                                  click: () => c.action(() => syncBook(link.id, 'remote'))
                                }}
                              >
                                {'Use WebDAV conflicts'}
                              </Dom>
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <Dom as="h3">
                    <Dom as="a" href={resolve(`/b?id=${link.bookId}`)}>
                      {link.title}
                    </Dom>
                  </Dom>
                  <Dom as="p" role={'status'}>
                    {c.$bookSyncStatus[link.id]?.message ?? 'Ready to sync through your account.'}
                  </Dom>
                  <Dom
                    as="button"
                    disabled={c.busy}
                    events={{ click: () => c.action(() => syncBook(link.id)) }}
                  >
                    {'Sync '}
                    {link.title}
                  </Dom>
                </Dom>
              </React.Fragment>
            ))}
          </Dom>
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
