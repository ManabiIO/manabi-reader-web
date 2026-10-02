/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import {
  Dom,
  ReaderScope,
  Button,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createNotes, type NotesProps } from './notes-controller';
import { localProfileUser } from '$lib/manabi/client';
import { editImportedNote, exportImportedNotes } from '$lib/manabi/imported-notes';

export function ImportedYatsuNotes(props: Partial<NotesProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createNotes(props as NotesProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-notes">
      {c.open && c.bookKey ? (
        <>
          <Dom
            as="section"
            aria-label={'Imported Yatsu notes'}
            className={['mt-5 border-t border-border pt-4'].filter(Boolean).join(' ')}
          >
            <Dom as="h3" className={['text-sm font-semibold'].filter(Boolean).join(' ')}>
              {'Imported Yatsu notes'}
            </Dom>
            {c.records.length ? (
              <>
                <Dom
                  as="p"
                  className={['mt-2 text-sm text-muted-foreground'].filter(Boolean).join(' ')}
                >
                  {
                    ' Book notes and unlocated saved passages remain editable here. Verified passages appear above. Original source records are preserved for recovery. '
                  }
                </Dom>
                <Dom as="div" className={['my-3 flex flex-wrap gap-2'].filter(Boolean).join(' ')}>
                  <Button
                    variant={'ghost'}
                    disabled={c.busy}
                    onClick={() =>
                      c.action(async () => {
                        c.editing = '';
                      })
                    }
                  >
                    {'Reload latest notes'}
                  </Button>
                  <Button
                    variant={'ghost'}
                    disabled={c.busy}
                    onClick={() =>
                      c.action(async () =>
                        c.download(await exportImportedNotes(c.bookId, c.bookKey))
                      )
                    }
                  >
                    {'Download imported notes'}
                  </Button>
                </Dom>
                {(c.visible ?? []).map((row, index0) => (
                  <React.Fragment key={row.id}>
                    <Dom
                      as="article"
                      className={['mb-3 rounded-lg border border-border p-3']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <Dom
                        as="p"
                        className={['text-xs text-muted-foreground'].filter(Boolean).join(' ')}
                      >
                        {row.status === 'book-note'
                          ? 'Book note'
                          : 'Unlocated ' + (row.part === 'highlights' ? 'highlight' : 'bookmark')}
                      </Dom>
                      <Dom
                        as="h4"
                        className={['mt-1 break-words text-sm font-medium']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {row.label}
                      </Dom>
                      {row.quote ? (
                        <>
                          <Dom
                            as="blockquote"
                            className={['mt-2 whitespace-pre-wrap break-words text-sm']
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {row.quote}
                          </Dom>
                        </>
                      ) : null}
                      {c.editing === row.id ? (
                        <>
                          <Dom
                            as="label"
                            className={['mt-2 block text-sm'].filter(Boolean).join(' ')}
                          >
                            {'Title'}
                            <Dom
                              as="input"
                              value={c.label}
                              maxLength={512}
                              disabled={c.busy}
                              className={[
                                'mt-1 w-full rounded border border-input bg-background p-2'
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              bindings={{
                                value: (value) => {
                                  c.label = value;
                                }
                              }}
                            />
                          </Dom>
                          <Dom
                            as="label"
                            className={['mt-2 block text-sm'].filter(Boolean).join(' ')}
                          >
                            {'Note'}
                            <Dom
                              as="textarea"
                              value={c.body}
                              maxLength={65536}
                              disabled={c.busy}
                              className={[
                                'mt-1 min-h-28 w-full rounded border border-input bg-background p-2'
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              bindings={{
                                value: (value) => {
                                  c.body = value;
                                }
                              }}
                            ></Dom>
                          </Dom>
                          <Dom
                            as="div"
                            className={['mt-2 flex flex-wrap gap-2'].filter(Boolean).join(' ')}
                          >
                            <Button
                              size={'sm'}
                              disabled={c.busy}
                              onClick={() =>
                                c.action(async () => {
                                  await editImportedNote(row, c.body, c.label);
                                  c.editing = '';
                                })
                              }
                            >
                              {'Save imported note'}
                            </Button>
                            <Button
                              size={'sm'}
                              variant={'ghost'}
                              disabled={c.busy}
                              onClick={() => (c.editing = '')}
                            >
                              {'Cancel'}
                            </Button>
                          </Dom>
                        </>
                      ) : (
                        <>
                          {' '}
                          {row.body ? (
                            <>
                              <Dom
                                as="p"
                                className={['mt-2 whitespace-pre-wrap break-words text-sm']
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                {row.body}
                              </Dom>
                            </>
                          ) : null}
                          {row.reason ? (
                            <>
                              <Dom
                                as="p"
                                className={['mt-2 text-xs text-muted-foreground']
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                {row.reason}
                              </Dom>
                            </>
                          ) : null}
                          <Dom
                            as="div"
                            className={['mt-2 flex flex-wrap gap-2'].filter(Boolean).join(' ')}
                          >
                            <Button
                              size={'sm'}
                              variant={'ghost'}
                              disabled={c.busy}
                              onClick={() => {
                                c.editing = row.id;
                                c.body = row.body;
                                c.label = row.label;
                              }}
                            >
                              {'Edit imported note'}
                            </Button>
                            <Button
                              size={'sm'}
                              variant={'ghost'}
                              disabled={c.busy}
                              onClick={() =>
                                c.action(async () => {
                                  await editImportedNote(row, row.body, row.label, true);
                                })
                              }
                            >
                              {'Remove imported note'}
                            </Button>
                          </Dom>
                        </>
                      )}
                    </Dom>
                  </React.Fragment>
                ))}
                <Dom as="details" className={['my-3 text-sm'].filter(Boolean).join(' ')}>
                  <Dom as="summary">
                    {'Original source records ('}
                    {c.records.length}
                    {')'}
                  </Dom>
                  <Dom
                    as="p"
                    className={['mt-2 text-xs text-muted-foreground'].filter(Boolean).join(' ')}
                  >
                    {
                      ' The download includes all records, including removed notes and original Yatsu fields. Manabi connection credentials and account scope fields are not exported. Restore it into this book, or a verified reimport of the same book. '
                    }
                  </Dom>
                </Dom>
              </>
            ) : null}
            <Dom as="div" className={['my-2'].filter(Boolean).join(' ')}>
              <Button
                variant={'outline'}
                disabled={c.busy}
                aria-expanded={c.restorePickerOpen}
                onClick={() => (c.restorePickerOpen = !c.restorePickerOpen)}
              >
                {'Restore imported notes'}
              </Button>
              {c.restorePickerOpen ? (
                <>
                  <Dom as="label" className={['mt-2 block text-sm'].filter(Boolean).join(' ')}>
                    {'Notebook archive'}
                    <Dom
                      as="input"
                      aria-label={'Choose imported notes archive'}
                      type={'file'}
                      accept={'.json,application/json'}
                      disabled={c.busy}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        const identity = c.signature,
                          owner = localProfileUser()?.id ?? null;
                        event.currentTarget.value = '';
                        if (file)
                          void c.action(async () => {
                            if (file.size > 16 * 1024 * 1024)
                              throw new Error('Notebook archive is too large.');
                            const json = await file.text();
                            if (
                              !c.mounted ||
                              identity !== c.signature ||
                              owner !== (localProfileUser()?.id ?? null)
                            )
                              return;
                            await c.restore(json);
                          });
                      }}
                      className={['mt-2 block max-w-full text-sm'].filter(Boolean).join(' ')}
                    />
                  </Dom>
                </>
              ) : null}
            </Dom>
            {c.pendingArchive ? (
              <>
                <Dom as="div" className={['my-2 flex flex-wrap gap-2'].filter(Boolean).join(' ')}>
                  <Button
                    variant={'outline'}
                    disabled={c.busy}
                    onClick={() => {
                      c.pendingArchive = undefined;
                      c.error = '';
                    }}
                  >
                    {'Keep device notes'}
                  </Button>
                  <Button
                    disabled={c.busy}
                    onClick={() => c.action(() => c.restore(c.pendingArchive!, true))}
                  >
                    {'Use notebook archive'}
                  </Button>
                </Dom>
              </>
            ) : null}
            {c.error ? (
              <>
                <Dom
                  as="p"
                  role={'alert'}
                  className={['mt-2 text-sm text-destructive'].filter(Boolean).join(' ')}
                >
                  {c.error}
                </Dom>
              </>
            ) : null}
            {c.message ? (
              <>
                <Dom as="p" role={'status'} className={['mt-2 text-sm'].filter(Boolean).join(' ')}>
                  {c.message}
                </Dom>
              </>
            ) : null}
          </Dom>
        </>
      ) : null}
    </ReaderScope>
  );
}
