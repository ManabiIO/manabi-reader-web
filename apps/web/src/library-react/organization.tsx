/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Fragment, type ReactNode } from 'react';
/**
 * React/controller port of lib/library/book-organization-dialog.svelte; transactions retain their original guards.
 */

import { OrganizationController } from './organization-controller';

import { Action, Button, Dialog } from './primitives';

export function OrganizationView({
  c,
  children: _children
}: {
  c: OrganizationController;
  children?: ReactNode;
}) {
  return (
    <>
      <Dialog.Root
        open={c.open}
        onOpenChange={(value: any) => {
          c.open = value;
        }}
      >
        <Dialog.Content
          closeDisabled={c.busy}
          className={['sm:max-w-xl'].filter(Boolean).join(' ')}
        >
          <Dialog.Header>
            <Dialog.Title>
              {c.mode === 'metadata'
                ? 'Edit book metadata'
                : c.mode === 'series'
                  ? 'Add to series'
                  : 'Add to collection'}
            </Dialog.Title>
            <Dialog.Description>
              {c.mode === 'metadata'
                ? 'Edit your Library metadata. The original EPUB, reading position, notes and history are unchanged.'
                : c.mode === 'series'
                  ? `Organize ${c.targets.length} selected ${c.targets.length === 1 ? 'book' : 'books'} in a new or existing personal series. Original files stay where they are.`
                  : `Update collections for ${c.targets.length} selected ${c.targets.length === 1 ? 'book' : 'books'}. Mixed checkboxes mean only some are included.`}
            </Dialog.Description>
          </Dialog.Header>
          {c.mode === 'collections' ? (
            <>
              <div className={['grid gap-2'].filter(Boolean).join(' ')}>
                {c.collections.map((collection, __index) => (
                  <Fragment key={collection.id}>
                    {(() => {
                      const count = c.members(collection);
                      return (
                        <>
                          <label
                            className={[
                              'flex min-h-11 items-center gap-3 rounded-xl border border-border px-3'
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <Action
                              type={'checkbox'}
                              checked={count === c.targets.length}
                              disabled={c.busy}
                              onChange={(event: any) => {
                                const included = event.currentTarget.checked;
                                void c.run(() => c.membership(collection.id, included));
                              }}
                              as={'input'}
                              action={c.mixed}
                              options={count > 0 && count < c.targets.length}
                            />
                            <span className={['min-w-0 break-words'].filter(Boolean).join(' ')}>
                              {collection.name}
                            </span>
                          </label>
                        </>
                      );
                    })()}
                  </Fragment>
                ))}
              </div>
              <form
                onSubmit={(event: any) => {
                  event.preventDefault();
                  void c.run(async () => {
                    await c.create(c.collectionName);
                    if (c.alive) c.collectionName = '';
                  });
                }}
                className={['flex flex-wrap items-end gap-2'].filter(Boolean).join(' ')}
              >
                <label className={['grid min-w-0 flex-1 gap-2'].filter(Boolean).join(' ')}>
                  {'New collection name '}
                  <input
                    maxLength={240}
                    required={true}
                    disabled={c.busy}
                    value={c.collectionName}
                    onChange={(event: any) => {
                      c.collectionName = event.currentTarget.value;
                    }}
                    className={['metadata-input'].filter(Boolean).join(' ')}
                  />
                </label>
                <Button type={'submit'} variant={'secondary'} disabled={c.busy}>
                  {'Create'}
                </Button>
              </form>
              <Dialog.Footer>
                <Button variant={'secondary'} disabled={c.busy} onClick={() => (c.open = false)}>
                  {'Done'}
                </Button>
              </Dialog.Footer>
            </>
          ) : (
            <>
              <form
                onSubmit={(event: any) => {
                  event.preventDefault();
                  c.submit();
                }}
                className={['grid gap-4'].filter(Boolean).join(' ')}
              >
                <fieldset
                  disabled={c.busy}
                  className={['grid min-w-0 gap-4'].filter(Boolean).join(' ')}
                >
                  {c.mode === 'metadata' ? (
                    <>
                      <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                        {'Title'}
                        <input
                          maxLength={1000}
                          required={true}
                          value={c.title}
                          onChange={(event: any) => {
                            c.title = event.currentTarget.value;
                          }}
                          className={['metadata-input'].filter(Boolean).join(' ')}
                        />
                      </label>
                      <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                        {'Authors (one per line)'}
                        <textarea
                          rows={3}
                          maxLength={16415}
                          value={c.authors}
                          onChange={(event: any) => {
                            c.authors = event.currentTarget.value;
                          }}
                          className={['metadata-input'].filter(Boolean).join(' ')}
                        />
                      </label>
                      <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                        {'Author sort names (matching lines, optional)'}
                        <textarea
                          rows={2}
                          maxLength={16415}
                          value={c.authorSort}
                          onChange={(event: any) => {
                            c.authorSort = event.currentTarget.value;
                          }}
                          className={['metadata-input'].filter(Boolean).join(' ')}
                        />
                      </label>
                      <div
                        className={['grid min-w-0 gap-4 sm:grid-cols-2'].filter(Boolean).join(' ')}
                      >
                        <label className={['grid min-w-0 gap-2'].filter(Boolean).join(' ')}>
                          {'Language'}
                          <input
                            maxLength={128}
                            value={c.language}
                            onChange={(event: any) => {
                              c.language = event.currentTarget.value;
                            }}
                            className={['metadata-input'].filter(Boolean).join(' ')}
                          />
                        </label>
                        <label className={['grid min-w-0 gap-2'].filter(Boolean).join(' ')}>
                          {'Published'}
                          <input
                            maxLength={128}
                            placeholder={'For example, 2024-03-01'}
                            value={c.published}
                            onChange={(event: any) => {
                              c.published = event.currentTarget.value;
                            }}
                            className={['metadata-input'].filter(Boolean).join(' ')}
                          />
                        </label>
                      </div>
                      <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                        {'Publisher'}
                        <input
                          maxLength={512}
                          value={c.publisher}
                          onChange={(event: any) => {
                            c.publisher = event.currentTarget.value;
                          }}
                          className={['metadata-input'].filter(Boolean).join(' ')}
                        />
                      </label>
                      <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                        {'Tags (one per line)'}
                        <textarea
                          rows={2}
                          maxLength={15423}
                          value={c.subjects}
                          onChange={(event: any) => {
                            c.subjects = event.currentTarget.value;
                          }}
                          className={['metadata-input'].filter(Boolean).join(' ')}
                        />
                      </label>
                      <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                        {'Description'}
                        <textarea
                          rows={5}
                          maxLength={16000}
                          value={c.description}
                          onChange={(event: any) => {
                            c.description = event.currentTarget.value;
                          }}
                          className={['metadata-input'].filter(Boolean).join(' ')}
                        />
                      </label>
                      <label
                        className={['flex min-h-11 items-center gap-3'].filter(Boolean).join(' ')}
                      >
                        <input
                          type={'checkbox'}
                          checked={c.coverBlur}
                          onChange={(event: any) => {
                            c.coverBlur = event.currentTarget.checked;
                          }}
                        />
                        {'Blur cover'}
                      </label>
                    </>
                  ) : null}
                  <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                    {'Series'}
                    <input
                      list={'personal-series-names'}
                      maxLength={240}
                      placeholder={'Choose or enter a series name'}
                      value={c.seriesName}
                      onChange={(event: any) => {
                        c.seriesName = event.currentTarget.value;
                      }}
                      className={['metadata-input'].filter(Boolean).join(' ')}
                    />
                  </label>
                  <datalist id={'personal-series-names'}>
                    {c.seriesNames.map((name, __index) => (
                      <Fragment key={name}>
                        <option value={name} />
                      </Fragment>
                    ))}
                  </datalist>
                  {c.mode === 'metadata' ? (
                    <>
                      <label className={['grid gap-2'].filter(Boolean).join(' ')}>
                        {'Number in series'}
                        <input
                          type={'text'}
                          inputMode={'decimal'}
                          disabled={!c.seriesName.trim()}
                          placeholder={'Optional, for example 2 or 2.5'}
                          value={c.seriesIndex}
                          onChange={(event: any) => {
                            c.seriesIndex = event.currentTarget.value;
                          }}
                          className={['metadata-input'].filter(Boolean).join(' ')}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <p className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}>
                        {
                          ' Leave the name empty to remove personal series membership. Edit individual metadata to set volume numbers. '
                        }
                      </p>
                    </>
                  )}
                </fieldset>
                <Dialog.Footer>
                  <Button variant={'outline'} disabled={c.busy} onClick={() => (c.open = false)}>
                    {'Cancel'}
                  </Button>
                  <Button type={'submit'} variant={'secondary'} disabled={c.busy}>
                    {c.busy ? 'Saving…' : 'Save'}
                  </Button>
                </Dialog.Footer>
              </form>
            </>
          )}
          {c.error ? (
            <>
              <p role={'alert'} className={['text-sm text-destructive'].filter(Boolean).join(' ')}>
                {c.error}
              </p>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
import { useController, useControllerProps } from './use-controller';
type OrganizationProps = Pick<
  OrganizationController,
  'mode' | 'targets' | 'collections' | 'seriesNames' | 'save' | 'membership' | 'create' | 'close'
>;
export function OrganizationDialog(props: OrganizationProps) {
  const c = useController(() => {
    const model = new OrganizationController();
    Object.assign(model, props);
    model.initialize();
    return model;
  });
  useControllerProps(c, props);
  return <OrganizationView c={c} />;
}
