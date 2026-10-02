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
  Icon,
  Button,
  CloseButton,
  Sheet,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createAnnotations, type AnnotationsProps } from './annotations-controller';
import { ImportedYatsuNotes } from './notes';

export function ReaderAnnotations(props: Partial<AnnotationsProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createAnnotations(props as AnnotationsProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-annotations">
      <Sheet.Root open={c.open} onOpenChange={(value) => (c.open = value)}>
        <Sheet.Content
          ref={c.contentElement}
          side={'left'}
          showCloseButton={false}
          closeDisabled={c.busy}
          onCloseAutoFocus={(event) => {
            const controls = document.querySelector<HTMLButtonElement>(
              'button[data-reader-controls]'
            );
            if (controls) {
              event.preventDefault();
              controls.focus({ preventScroll: true });
            }
          }}
          aria-busy={c.busy}
          className={[
            'writing-horizontal-tb overflow-hidden p-[20px] pb-0 data-[side=left]:w-full data-[side=left]:sm:max-w-md'
          ]
            .filter(Boolean)
            .join(' ')}
          bindings={{
            ref: (value) => {
              c.contentElement = value;
            }
          }}
        >
          <Sheet.Header
            className={[
              'grid shrink-0 grid-cols-[minmax(0,1fr)_44px] items-start gap-3 border-b border-border bg-popover p-0 pb-4'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Dom as="div" className={['min-w-0'].filter(Boolean).join(' ')}>
              <Sheet.Title className={['break-words'].filter(Boolean).join(' ')}>
                {'Bookmarks & Notes'}
              </Sheet.Title>
            </Dom>
            <CloseButton
              aria-label={'Close bookmarks and notes'}
              disabled={c.busy}
              onClick={() => (c.open = false)}
            ></CloseButton>
          </Sheet.Header>
          <Dom
            as="div"
            data-annotations-scroll={true}
            className={[
              'min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(20px,env(safe-area-inset-bottom))]'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Sheet.Description>{'Saved places and passages in this book.'}</Sheet.Description>
            <Dom
              as="div"
              className={['mt-5 flex shrink-0 flex-wrap gap-2'].filter(Boolean).join(' ')}
            >
              <Button
                data-annotations-primary={true}
                variant={'secondary'}
                disabled={c.busy}
                onClick={() => c.dispatch('bookmark')}
              >
                <Icon name="BookmarkSimple" aria-hidden={'true'}></Icon>
                {'Add Bookmark'}
              </Button>
              <Button
                variant={'secondary'}
                disabled={c.busy || !c.hasSelection}
                onClick={() => c.dispatch('highlight')}
              >
                <Icon name="Highlighter" aria-hidden={'true'}></Icon>
                {'Highlight Selection'}
              </Button>
              <Button
                variant={'secondary'}
                disabled={c.busy || !c.hasSelection}
                onClick={() => c.dispatch('snippet')}
              >
                {'Add to Snippet…'}
              </Button>
            </Dom>
            <Dom
              as="div"
              className={['mt-3 flex shrink-0 flex-wrap items-center gap-2']
                .filter(Boolean)
                .join(' ')}
            >
              <Button variant={'ghost'} disabled={c.busy} onClick={() => c.dispatch('export')}>
                <Icon name="DownloadSimple" aria-hidden={'true'}></Icon>
                {'Export Notes'}
              </Button>
              <Dom
                as="label"
                aria-label={'Import notes'}
                className={[
                  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-sm font-medium hover:bg-muted focus-within:outline-2 focus-within:outline-ring',
                  c.busy && 'opacity-50',
                  c.busy && 'pointer-events-none'
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <Icon name="UploadSimple" aria-hidden={'true'}></Icon>
                {'Import Notes '}
                <Dom
                  as="input"
                  type={'file'}
                  accept={'application/json,.json'}
                  disabled={c.busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) c.dispatch('import', file);
                    event.currentTarget.value = '';
                  }}
                  className={['sr-only'].filter(Boolean).join(' ')}
                />
              </Dom>
            </Dom>
            {c.hasSelection ? (
              <>
                <Dom as="div" className={['mt-4 grid shrink-0 gap-2'].filter(Boolean).join(' ')}>
                  <Dom
                    as="label"
                    htmlFor={'reader-note'}
                    className={['text-sm font-medium'].filter(Boolean).join(' ')}
                  >
                    {'Note on selected passage'}
                  </Dom>
                  <Dom
                    as="textarea"
                    id={'reader-note'}
                    maxLength={'65536'}
                    disabled={c.busy}
                    value={c.note}
                    placeholder={'Write a note…'}
                    className={[
                      'min-h-24 rounded-lg border border-input bg-background p-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    bindings={{
                      value: (value) => {
                        c.note = value;
                      }
                    }}
                  ></Dom>
                  <Button disabled={c.busy || !c.note.trim()} onClick={c.addNote}>
                    <Icon name="NotePencil" aria-hidden={'true'}></Icon>
                    {'Save Note'}
                  </Button>
                </Dom>
              </>
            ) : null}
            {c.error ? (
              <>
                <Dom
                  as="p"
                  role={'alert'}
                  className={['mt-3 text-sm text-destructive'].filter(Boolean).join(' ')}
                >
                  {c.error}
                </Dom>
              </>
            ) : null}
            {c.status ? (
              <>
                <Dom
                  as="p"
                  role={'status'}
                  className={['mt-3 text-sm text-muted-foreground'].filter(Boolean).join(' ')}
                >
                  {c.status}
                </Dom>
              </>
            ) : null}
            {c.importConflicts.length ? (
              <>
                <Dom
                  as="section"
                  aria-label={'Archive conflicts'}
                  className={['mt-4 rounded-lg border border-border p-3'].filter(Boolean).join(' ')}
                >
                  <Dom as="h3" className={['text-sm font-semibold'].filter(Boolean).join(' ')}>
                    {'Archive conflicts'}
                  </Dom>
                  <Dom
                    as="p"
                    className={['mt-1 text-xs text-muted-foreground'].filter(Boolean).join(' ')}
                  >
                    {
                      ' Review saved passages that differ from the archive. Your current copy stays intact until you choose. '
                    }
                  </Dom>
                  {(c.importConflicts ?? []).map((conflict, index0) => (
                    <React.Fragment key={conflict.id}>
                      <Dom
                        as="div"
                        className={['mt-3 border-t border-border pt-3'].filter(Boolean).join(' ')}
                      >
                        <Dom as="p" className={['text-sm'].filter(Boolean).join(' ')}>
                          {conflict.remote.body ||
                            conflict.remote.targets[0].quote ||
                            'Saved reading position'}
                        </Dom>
                        <Dom
                          as="p"
                          className={['mt-1 text-xs text-muted-foreground']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {conflict.local.deletedAt ? 'Removed locally' : 'Different local version'}
                        </Dom>
                        <Dom
                          as="div"
                          className={['mt-2 flex flex-wrap gap-2'].filter(Boolean).join(' ')}
                        >
                          <Button
                            size={'sm'}
                            variant={'outline'}
                            disabled={c.busy}
                            onClick={() =>
                              c.dispatch('resolveImport', { id: conflict.id, choice: 'keep-local' })
                            }
                          >
                            {'Keep Current'}
                          </Button>
                          <Button
                            size={'sm'}
                            disabled={c.busy}
                            onClick={() =>
                              c.dispatch('resolveImport', {
                                id: conflict.id,
                                choice: 'restore-archive'
                              })
                            }
                          >
                            {'Use Archive'}
                          </Button>
                        </Dom>
                      </Dom>
                    </React.Fragment>
                  ))}
                </Dom>
              </>
            ) : null}
            <ImportedYatsuNotes
              bookId={c.bookId}
              bookKey={c.bookKey}
              open={c.open}
            ></ImportedYatsuNotes>
            <Dom
              as="div"
              aria-label={'Saved annotations'}
              className={['mt-6 shrink-0'].filter(Boolean).join(' ')}
            >
              {!c.annotations.length ? (
                <>
                  <Dom
                    as="p"
                    className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
                  >
                    {' No saved bookmarks or notes yet. '}
                  </Dom>
                </>
              ) : null}
              {(c.annotations ?? []).map((annotation, index) => (
                <React.Fragment key={annotation.id}>
                  <Dom
                    as="div"
                    className={['flex items-start gap-1 border-b border-border py-2']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Dom
                      as="button"
                      type={'button'}
                      disabled={c.busy}
                      onClick={() => {
                        if (!c.busy) c.dispatch('openAnnotation', annotation);
                      }}
                      className={[
                        'min-h-11 min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <Dom
                        as="span"
                        className={['block text-xs font-medium text-muted-foreground']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {annotation.kind === 'bookmark'
                          ? 'Bookmark'
                          : annotation.kind === 'note'
                            ? 'Note'
                            : 'Highlight'}
                        {' · Section '}
                        {annotation.targets[0].resource.spineIndex + 1}
                      </Dom>
                      <Dom
                        as="span"
                        className={['mt-1 block break-words text-sm'].filter(Boolean).join(' ')}
                      >
                        {annotation.label ||
                          annotation.body ||
                          annotation.targets[0].quote ||
                          'Saved reading position'}
                        {annotation.label && (annotation.body || annotation.targets[0].quote) ? (
                          <>
                            <Dom
                              as="span"
                              className={['mt-1 block text-muted-foreground']
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {annotation.body || annotation.targets[0].quote}
                            </Dom>
                          </>
                        ) : null}
                      </Dom>
                      <Dom as="span" className={['sr-only'].filter(Boolean).join(' ')}>
                        {'Go to saved passage'}
                      </Dom>
                    </Dom>
                    <Button
                      variant={'ghost'}
                      size={'icon'}
                      aria-label={`Remove ${annotation.kind}`}
                      data-annotation-remove={true}
                      disabled={c.busy}
                      onClick={() => c.removeWithFocus(annotation.id, index)}
                      className={['size-11 shrink-0 self-end'].filter(Boolean).join(' ')}
                    >
                      <Icon name="Trash" aria-hidden={'true'}></Icon>
                    </Button>
                  </Dom>
                </React.Fragment>
              ))}
            </Dom>
          </Dom>
        </Sheet.Content>
      </Sheet.Root>
    </ReaderScope>
  );
}
