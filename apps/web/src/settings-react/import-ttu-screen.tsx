/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
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
import { createImportTtuScreen, type ImportTtuScreenProps } from './import-ttu-screen-controller';
import { ImportTtuFilePicker } from './import-ttu-file-picker';

import { resolve } from '$app/paths';

import { importLabels } from '$lib/manabi/ttu-migration-format';
export function ImportTtuScreen(
  props: Partial<ImportTtuScreenProps> &
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
      createImportTtuScreen(
        props as ImportTtuScreenProps,
        (name, detail) => {
          latest.current.events?.[name]?.({ detail });
          if (name === 'close') latest.current.onClose?.();
        },
        context
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <SettingsContext.Provider value={context}>
      <div className="react-settings-import-ttu-screen" style={{ display: 'contents' }}>
        <Dom
          as="header"
          className={[
            'app-header flex min-h-12 items-center justify-end border-b border-border bg-card px-3'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <AppNav></AppNav>
        </Dom>
        <Head>
          <Dom as="title">
            {'Import from '}
            {c.yatsu ? 'Yatsu Reader' : 'Ttu Ebook Reader'}
            {' · Manabi Reader'}
          </Dom>
        </Head>
        <Dom as="main" className={['migration-page'].filter(Boolean).join(' ')}>
          <Dom
            as="nav"
            aria-label={'Context navigation'}
            className={['page-navigation'].filter(Boolean).join(' ')}
          >
            <Button
              href={resolve('/manage')}
              variant={'link'}
              size={'sm'}
              aria-label={'Back to Library'}
            >
              {'← Library'}
            </Button>
          </Dom>
          <Dom as="h1">{`Import from ${c.yatsu ? 'Yatsu Reader' : 'Ttu Ebook Reader'}`}</Dom>
          {!c.yatsu ? (
            <>
              <Dom as="section" aria-labelledby={'export-instructions'}>
                <Dom as="h2" id={'export-instructions'}>
                  {'Export in Ttu Ebook Reader'}
                </Dom>
                <Dom as="ol">
                  <Dom as="li">
                    {' In Book Manager, enter selection mode and select books or '}
                    <Dom as="strong">{'Select All Books'}</Dom>
                    {'. '}
                  </Dom>
                  <Dom as="li">
                    {'Choose '}
                    <Dom as="strong">{'Export → ZIP File'}</Dom>
                    {'.'}
                  </Dom>
                  <Dom as="li">
                    {' Include '}
                    <Dom as="strong">{'Book Data'}</Dom>
                    {', '}
                    <Dom as="strong">{'Bookmark'}</Dom>
                    {' and '}
                    <Dom as="strong">{'Statistics'}</Dom>
                    {', then choose '}
                    <Dom as="strong">{'Start'}</Dom>
                    {'. '}
                  </Dom>
                </Dom>
                <Dom as="p">{'Choose the ZIPs below. A few books at a time is fine.'}</Dom>
                <Dom as="details">
                  <Dom as="summary">{'Other exported data'}</Dom>
                  <Dom as="p">
                    {
                      ' Audiobook position and subtitles are supported. Export Reading Goals separately from Statistics → Reading Goals. '
                    }
                  </Dom>
                  <Dom as="p">
                    {
                      ' Data-only ZIPs need Book Data imported first. Choose the matching imported book below. Audio files and the original EPUB are not included in Ttu exports. '
                    }
                  </Dom>
                </Dom>
              </Dom>
            </>
          ) : (
            <>
              {' '}
              <Dom as="section" aria-labelledby={'yatsu-export-instructions'}>
                <Dom as="h2" id={'yatsu-export-instructions'}>
                  {'Export in Yatsu Reader'}
                </Dom>
                <Dom as="p">
                  {' In the Library, open More library actions and choose '}
                  <Dom as="strong">{'Get complete local backup'}</Dom>
                  {
                    '. Select that ZIP below. Version-11 backups include book data, current reading position, collection tags, statistics, saved bookmarks, highlights, passage notes and book notes. Safe reader settings are optional and unchecked by default. Original note records are retained; an ambiguous passage stays available in Imported Yatsu notes rather than jumping to a guessed location. Keep your original ZIP for unsupported settings and external audio files. '
                  }
                </Dom>
              </Dom>
            </>
          )}
          <Dom as="label" className={['file-picker'].filter(Boolean).join(' ')}>
            {'Choose '}
            {c.yatsu ? 'Yatsu backup' : 'Ttu export'}
            {' ZIPs '}
            <ImportTtuFilePicker owner={c} />
          </Dom>
          <Dom as="p">{'Imports stay on this device. No sign-in or cloud access is required.'}</Dom>
          {c.message ? (
            <>
              <Dom as="p" role={'status'}>
                {c.message}
              </Dom>
            </>
          ) : null}
          {c.rows.length ? (
            <>
              <Dom as="details">
                <Dom as="summary">{'Data to import'}</Dom>
                <Dom as="div" className={['parts'].filter(Boolean).join(' ')}>
                  {(Object.entries(importLabels) ?? []).map(([part, label], _index0) => (
                    <React.Fragment key={part}>
                      {!['metadata', 'savedBookmarks', 'highlights', 'notes', 'settings'].includes(
                        part
                      ) || c.sources.some((source) => source.source === 'yatsu') ? (
                        <>
                          <Dom as="label">
                            <Dom
                              as="input"
                              type={'checkbox'}
                              group={c.parts}
                              value={part}
                              disabled={c.busy}
                              bindings={{
                                group: (value: typeof c.parts) => {
                                  c.controller.changed((c.parts = value));
                                }
                              }}
                            />
                            {label}
                          </Dom>
                        </>
                      ) : null}
                    </React.Fragment>
                  ))}
                  <Dom as="p">
                    {
                      ' Settings require selecting both the settings row and its data-type checkbox. Existing Manabi sync choices and credentials are never imported. '
                    }
                  </Dom>
                </Dom>
              </Dom>
              <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                <Button
                  variant={'ghost'}
                  disabled={c.busy}
                  onClick={() => {
                    c.controller.changed(
                      (c.rows = c.rows.map((row) => ({ ...row, selected: !row.error })))
                    );
                  }}
                >
                  {'Select all'}
                </Button>
                <Button
                  variant={'ghost'}
                  disabled={c.busy}
                  onClick={() => {
                    c.controller.changed(
                      (c.rows = c.rows.map((row) => ({ ...row, selected: false })))
                    );
                  }}
                >
                  {'Select none'}
                </Button>
                <Button
                  variant={'default'}
                  disabled={c.busy || !c.selected.length || !c.parts.length}
                  onClick={() => c.run(c.selected)}
                >
                  {'Import selected ('}
                  {c.selected.length}
                  {')'}
                </Button>
                <Button variant={'ghost'} disabled={c.busy} onClick={c.clear}>
                  {'Clear list'}
                </Button>
              </Dom>
              {c.ignored ? (
                <>
                  <Dom as="p">
                    {c.ignored}
                    {
                      ' files are not covered by this importer and will be kept only in the original ZIP. Storage connections and credentials are never imported. '
                    }
                  </Dom>
                </>
              ) : null}
              {c.busy ? (
                <>
                  <Dom as="div" className={['actions'].filter(Boolean).join(' ')}>
                    <Dom
                      as="progress"
                      value={c.completed}
                      max={Math.max(c.total, 1)}
                      aria-label={'Import progress'}
                    ></Dom>
                    <Button variant={'outline'} onClick={c.cancel}>
                      {'Stop importing'}
                    </Button>
                  </Dom>
                </>
              ) : null}
              {c.rows.length > c.pageSize ? (
                <>
                  <Dom as="nav" aria-label={'Import pages'}>
                    <Button
                      variant={'ghost'}
                      size={'sm'}
                      disabled={c.page === 0}
                      onClick={() => c.page--}
                    >
                      {'Previous'}
                    </Button>
                    <Dom as="span">
                      {c.page * c.pageSize + 1}
                      {'–'}
                      {Math.min((c.page + 1) * c.pageSize, c.rows.length)}
                      {' of '}
                      {c.rows.length}
                    </Dom>
                    <Button
                      variant={'ghost'}
                      size={'sm'}
                      disabled={(c.page + 1) * c.pageSize >= c.rows.length}
                      onClick={() => c.page++}
                    >
                      {'Next'}
                    </Button>
                  </Dom>
                </>
              ) : null}
              <Dom
                as="div"
                aria-label={'Import preview'}
                aria-busy={c.busy}
                className={['import-list'].filter(Boolean).join(' ')}
              >
                {(c.visibleRows ?? []).map((row, _index1) => (
                  <React.Fragment key={row.key}>
                    <Dom as="article" aria-label={'Import ' + String(row.title ?? '')}>
                      <Dom as="label" className={['book-choice'].filter(Boolean).join(' ')}>
                        <Dom
                          as="input"
                          type={'checkbox'}
                          checked={row.selected}
                          disabled={c.busy || !!row.error}
                          bindings={{
                            checked: (value: boolean) => {
                              c.setRowSelection(row.key, value);
                            }
                          }}
                        />
                        {row.title}
                      </Dom>
                      <Dom as="p" className={['details'].filter(Boolean).join(' ')}>
                        {row.source.source === 'yatsu' ? 'Yatsu Reader' : 'Ttu Ebook Reader'}
                        {' · '}
                        {row.source.file.name}
                        {' · '}
                        {row.parts
                          .map(
                            (part) =>
                              `${importLabels[part]}${row.counts?.[part] !== undefined ? ` (${row.counts[part]})` : ''}`
                          )
                          .join(', ')}
                      </Dom>
                      {!row.parts.includes('goals') &&
                      !row.parts.includes('settings') &&
                      (!row.parts.includes('book') || row.status === 'conflict') ? (
                        <>
                          <Dom as="label">
                            {'Destination book '}
                            <Dom
                              as="select"
                              value={row.targetId}
                              disabled={c.busy}
                              aria-label={'Destination for ' + String(row.title ?? '')}
                              bindings={{
                                value: (value: number) => {
                                  c.setRowTarget(row.key, value);
                                }
                              }}
                            >
                              <Dom as="option" value={0}>
                                {'Choose a previously imported book'}
                              </Dom>
                              {(
                                c.choices.filter((book) => book.sourceTitle === row.title) ?? []
                              ).map((book, _index2) => (
                                <React.Fragment key={book.id}>
                                  <Dom as="option" value={book.id}>
                                    {book.title}
                                  </Dom>
                                </React.Fragment>
                              ))}
                            </Dom>
                          </Dom>
                        </>
                      ) : null}
                      {row.message ? (
                        <>
                          <Dom as="p" role={'status'}>
                            {row.message}
                          </Dom>
                        </>
                      ) : null}
                      {row.status === 'conflict' ? (
                        <>
                          <Dom as="p">
                            {
                              'Using imported data replaces conflicting reading records, not the book itself.'
                            }
                          </Dom>
                          <Button
                            variant={'destructive'}
                            disabled={c.busy}
                            onClick={() => c.run([row], true)}
                          >
                            {'Use imported data for '}
                            {row.title}
                          </Button>
                        </>
                      ) : null}
                      {row.bookId ? (
                        <>
                          <Button
                            href={resolve(`/b?id=${row.bookId}`)}
                            variant={'link'}
                            size={'sm'}
                          >
                            {'Read '}
                            {row.title}
                          </Button>
                        </>
                      ) : null}
                    </Dom>
                  </React.Fragment>
                ))}
              </Dom>
            </>
          ) : (
            <>
              {' '}
              {c.busy ? (
                <>
                  <Dom as="p" role={'status'}>
                    {'Inspecting ZIPs…'}
                  </Dom>
                  <Button variant={'outline'} onClick={c.cancel}>
                    {'Stop inspecting'}
                  </Button>
                </>
              ) : null}
            </>
          )}
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
