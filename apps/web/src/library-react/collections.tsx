/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Fragment, type ReactNode } from 'react';
/**
 * React/controller port of lib/library/collections-sheet.svelte; transactions retain their original guards.
 */

import { WANT_TO_READ_ID, collectionContains } from '$lib/library/want-to-read';
import { CollectionsController } from './collections-controller';
import { tick } from './observable-controller';
import { Button, Dialog, Sheet, CloseButton } from './primitives';
import {
  BookOpen,
  BookmarkSimple,
  CheckCircle as CircleCheck,
  List,
  PencilSimple,
  Plus,
  Trash,
  CaretRight
} from '@phosphor-icons/react';
export function CollectionsView({
  c,
  children: _children
}: {
  c: CollectionsController;
  children?: ReactNode;
}) {
  return (
    <>
      {!c.dialogOpen ? (
        <>
          <Sheet.Root
            open={c.open}
            onOpenChange={(value: any) => {
              c.open = value;
            }}
          >
            <Sheet.Content
              id={'library-collections-sheet'}
              side={'bottom'}
              showCloseButton={false}
              onOpenAutoFocus={(event: any) => {
                // This action sheet starts at its visible Edit control, unlike an
                // information/search sheet with potentially offscreen editable fields.
                if (c.editButton?.isConnected) {
                  event.preventDefault();
                  c.editButton.focus({ preventScroll: true });
                }
              }}
              onCloseAutoFocus={(event: any) => {
                if (c.dialogOpen) return;
                const trigger = document.querySelector<HTMLButtonElement>(
                  'button[aria-label="Collections"][aria-haspopup="dialog"]'
                );
                if (trigger?.isConnected) {
                  event.preventDefault();
                  trigger.focus({ preventScroll: true });
                }
              }}
              className={[
                'mx-auto max-h-[90dvh] max-w-xl overflow-hidden rounded-t-3xl p-[20px] px-[16px] pb-[max(20px,env(safe-area-inset-bottom))] sm:p-[24px]'
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <Sheet.Header
                className={[
                  'mb-[16px] flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-b border-border p-0 pb-[16px]'
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <Sheet.Title
                  className={['min-w-0 font-serif text-xl sm:text-2xl'].filter(Boolean).join(' ')}
                >
                  {'Collections'}
                </Sheet.Title>
                <div
                  className={['ms-auto flex shrink-0 items-center gap-2'].filter(Boolean).join(' ')}
                >
                  <Button
                    variant={'secondary'}
                    aria-pressed={c.editing}
                    onClick={() => (c.editing = !c.editing)}
                    ref={(element: any) => {
                      c.editButton = element;
                    }}
                    className={['min-h-11 rounded-full px-4'].filter(Boolean).join(' ')}
                  >
                    {c.editing ? 'Done' : 'Edit'}
                  </Button>
                  <CloseButton aria-label={'Close collections'} onClick={() => (c.open = false)} />
                </div>
                <Sheet.Description className={['sr-only'].filter(Boolean).join(' ')}>
                  {
                    'Organize books without moving their files. A book can be in several collections.'
                  }
                </Sheet.Description>
              </Sheet.Header>
              <div
                className={['collections-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div
                  className={[
                    'shrink-0 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    aria-current={c.active === 'books' ? 'page' : undefined}
                    onClick={() => c.choose('books')}
                    className={['collection-row'].filter(Boolean).join(' ')}
                  >
                    <BookOpen aria-hidden={'true'} />
                    <span>{'Books'}</span>
                    <span className={['count'].filter(Boolean).join(' ')}>{c.books.length}</span>
                    <CaretRight
                      aria-hidden={'true'}
                      className={['text-muted-foreground'].filter(Boolean).join(' ')}
                    />
                  </button>
                  <button
                    aria-current={c.active === WANT_TO_READ_ID ? 'page' : undefined}
                    onClick={() => c.choose(WANT_TO_READ_ID)}
                    className={['collection-row'].filter(Boolean).join(' ')}
                  >
                    <BookmarkSimple aria-hidden={'true'} />
                    <span>{'Want to Read'}</span>
                    <span className={['count'].filter(Boolean).join(' ')}>
                      {c.books.filter((book) => collectionContains(c.wantToRead, book)).length}
                    </span>
                    <CaretRight
                      aria-hidden={'true'}
                      className={['text-muted-foreground'].filter(Boolean).join(' ')}
                    />
                  </button>
                  <button
                    aria-current={c.active === 'finished' ? 'page' : undefined}
                    onClick={() => c.choose('finished')}
                    className={['collection-row'].filter(Boolean).join(' ')}
                  >
                    <CircleCheck aria-hidden={'true'} />
                    <span>{'Finished'}</span>
                    <span className={['count'].filter(Boolean).join(' ')}>{c.finished}</span>
                    <CaretRight
                      aria-hidden={'true'}
                      className={['text-muted-foreground'].filter(Boolean).join(' ')}
                    />
                  </button>
                </div>
                <p
                  className={['mt-4 shrink-0 text-xs text-muted-foreground']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {
                    ' Collections and book overrides sync with your Manabi Reader settings when account sync is on. Unavailable books stay in their collections and reappear when their library is connected. '
                  }
                </p>
                <div
                  className={[
                    'mt-6 shrink-0 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    onClick={() => c.edit()}
                    className={['collection-row'].filter(Boolean).join(' ')}
                  >
                    <Plus aria-hidden={'true'} />
                    <span>{'New Collection…'}</span>
                  </button>
                  {c.customCollections.map((collection, __index) => (
                    <Fragment key={collection.id}>
                      <div className={['collection-entry'].filter(Boolean).join(' ')}>
                        <button
                          aria-current={c.active === collection.id ? 'page' : undefined}
                          onClick={() => c.choose(collection.id)}
                          className={['collection-row'].filter(Boolean).join(' ')}
                        >
                          <List aria-hidden={'true'} />
                          <span
                            className={['min-w-0 [overflow-wrap:anywhere]']
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {collection.name}
                          </span>
                          <span className={['count'].filter(Boolean).join(' ')}>
                            {c.books.filter((book) => collectionContains(collection, book)).length}
                          </span>
                          {!c.editing ? (
                            <>
                              <CaretRight
                                aria-hidden={'true'}
                                className={['text-muted-foreground'].filter(Boolean).join(' ')}
                              />
                            </>
                          ) : null}
                        </button>
                        {c.editing ? (
                          <>
                            <div className={['collection-actions'].filter(Boolean).join(' ')}>
                              <Button
                                variant={'ghost'}
                                size={'icon'}
                                onClick={() => c.edit(collection)}
                                aria-label={`Rename collection ${collection.name}`}
                                title={'Rename collection'}
                                className={['size-[44px]'].filter(Boolean).join(' ')}
                              >
                                <PencilSimple aria-hidden={'true'} />
                              </Button>
                              <Button
                                variant={'ghost'}
                                size={'icon'}
                                onClick={() => c.edit(collection, true)}
                                aria-label={`Delete collection ${collection.name}`}
                                title={'Delete collection'}
                                className={['size-[44px] text-destructive hover:text-destructive']
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <Trash aria-hidden={'true'} />
                              </Button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            </Sheet.Content>
          </Sheet.Root>
        </>
      ) : null}
      <Dialog.Root
        open={c.dialogOpen}
        onOpenChange={(value: any) => {
          c.dialogOpen = value;
        }}
      >
        <Dialog.Content
          closeDisabled={c.busy}
          onCloseAutoFocus={(event: any) => {
            event.preventDefault();
            void tick().then(() => {
              const sheet = document.getElementById('library-collections-sheet');
              const target =
                sheet?.querySelector<HTMLButtonElement>('[aria-current="page"]') ??
                sheet?.querySelector<HTMLButtonElement>('button') ??
                document.querySelector<HTMLElement>('[aria-label="Library shelves"]');
              target?.focus();
            });
          }}
          className={['px-[16px] sm:px-[24px] [&_[data-slot=dialog-footer]_button]:min-h-11']
            .filter(Boolean)
            .join(' ')}
        >
          <Dialog.Header>
            <Dialog.Title>
              {c.deleting
                ? 'Delete collection?'
                : c.target
                  ? 'Rename collection'
                  : 'New collection'}
            </Dialog.Title>
            <Dialog.Description>
              {c.deleting
                ? 'Only this collection is removed. Its books, progress and files are kept.'
                : 'Choose a name for this collection.'}
            </Dialog.Description>
          </Dialog.Header>
          <form
            onSubmit={(event: any) => {
              event.preventDefault();
              c.submit();
            }}
            aria-busy={c.busy}
            className={['grid gap-5'].filter(Boolean).join(' ')}
          >
            {!c.deleting ? (
              <>
                <label className={['grid min-w-0 gap-2'].filter(Boolean).join(' ')}>
                  {'Name'}
                  <input
                    disabled={c.busy}
                    required={true}
                    maxLength={240}
                    value={c.name}
                    onChange={(event: any) => {
                      c.name = event.currentTarget.value;
                    }}
                    className={[
                      'min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base sm:text-sm'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                </label>
              </>
            ) : null}
            {c.error ? (
              <>
                <p role={'alert'} className={['text-destructive'].filter(Boolean).join(' ')}>
                  {c.error}
                </p>
              </>
            ) : null}
            <Dialog.Footer>
              <Button variant={'outline'} onClick={() => (c.dialogOpen = false)} disabled={c.busy}>
                {'Cancel'}
              </Button>
              <Button
                type={'submit'}
                variant={c.deleting ? 'destructive' : 'secondary'}
                disabled={c.busy}
              >
                {c.busy ? 'Saving…' : c.deleting ? 'Delete Collection' : 'Save'}
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
import { useEffect, useLayoutEffect } from 'react';
import { useController } from './use-controller';
type CollectionsProps = Pick<CollectionsController, 'open' | 'books' | 'active' | 'onchoose'> & {
  onOpenChange(open: boolean): void;
};
export function CollectionsSheet(props: CollectionsProps) {
  const c = useController(() => Object.assign(new CollectionsController(), props));
  useLayoutEffect(() => {
    c.open = props.open;
    c.books = props.books;
    c.active = props.active;
    c.onchoose = props.onchoose;
  }, [c, props.open, props.books, props.active, props.onchoose]);
  useEffect(
    () =>
      c.subscribe(() => {
        if (c.open !== props.open) props.onOpenChange(c.open);
      }),
    [c, props.open, props.onOpenChange]
  );
  return <CollectionsView c={c} />;
}
