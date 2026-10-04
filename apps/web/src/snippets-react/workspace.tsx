/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { CaretLeft } from '@phosphor-icons/react';
import { navigationReturnPath } from '../shared-ui/navigation-context';
import { readNavigationArrival } from '../runtime/navigation';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Head,
  Button,
  Input,
  AppNav,
  DynamicComponent,
  Dialog,
  Menu,
  ReaderScope,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './primitives';
import { createWorkspace, type WorkspaceProps } from './workspace-controller';

import { base, resolve } from '$app/paths';

import { refreshSnippets, trashSnippet } from '../lib/snippets/service';
import { drafts, deleteDraft } from '../lib/snippets/database';
import {
  displayTitle,
  encodeSnippet,
  passages,
  snippetSearchTooLong,
  filename
} from '../lib/snippets/document';
import { resumeTransfer, keepBoth } from '../lib/snippets/transfers';
import { saveLabel } from '../lib/snippets/presentation';
import { exportSnippets, download } from '../lib/snippets/portability';
import type { Editor } from '@tiptap/core';
import { SnippetReader } from './reader';
import { Shelf } from './shelf';
import { DestinationPicker } from './destination-picker';

export function Workspace(props: WorkspaceProps & ReaderViewProps) {
  const [returnHref] = React.useState(() => {
    const current = new URL(
      props.routeUrl ?? (typeof window === 'undefined' ? `${base}/snippets` : window.location.href),
      'https://reader.invalid'
    );
    return navigationReturnPath(current, readNavigationArrival(current)?.from, base);
  });
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createWorkspace(props as WorkspaceProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-snippets-workspace">
      <Head>
        <Dom scopeClass="snippet-scope-workspace" as="title">
          {c.current ? displayTitle(c.current.document) + ' — ' : ''}
          {'Snippets · Manabi Reader'}
        </Dom>
      </Head>
      <Dom
        scopeClass="snippet-scope-workspace"
        as="div"
        className={['snippet-workspace'].filter(Boolean).join(' ')}
      >
        <Dom
          scopeClass="snippet-scope-workspace"
          as="header"
          className={['top'].filter(Boolean).join(' ')}
        >
          <Button href={returnHref} variant="ghost" size="icon-lg" shape="circle" aria-label="Back">
            <CaretLeft size={20} aria-hidden="true" />
          </Button>
          <Dom scopeClass="snippet-scope-workspace" as="span" className="brand">
            Snippets
          </Dom>
          <AppNav></AppNav>
        </Dom>
        {c.error ? (
          <>
            <Dom
              scopeClass="snippet-scope-workspace"
              as="div"
              role={'alert'}
              className={['message error'].filter(Boolean).join(' ')}
            >
              {c.error}
              <Button variant={'ghost'} size={'sm'} onClick={() => (c.error = '')}>
                {'Dismiss'}
              </Button>
            </Dom>
          </>
        ) : null}
        {c.notice ? (
          <>
            <Dom
              scopeClass="snippet-scope-workspace"
              as="p"
              role={'status'}
              className={['message'].filter(Boolean).join(' ')}
            >
              {c.notice}
            </Dom>
          </>
        ) : null}
        {c.editing ? (
          <>
            <Dom
              scopeClass="snippet-scope-workspace"
              as="section"
              aria-label={c.editing.mode === 'append' ? 'Add text to snippet' : 'Snippet editor'}
              className={['editing'].filter(Boolean).join(' ')}
            >
              <Dom
                scopeClass="snippet-scope-workspace"
                as="div"
                className={['heading'].filter(Boolean).join(' ')}
              >
                <Dom scopeClass="snippet-scope-workspace" as="div">
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="p"
                    className={['eyebrow'].filter(Boolean).join(' ')}
                  >
                    {c.editing.mode === 'append'
                      ? 'ADD TO SNIPPET'
                      : c.editing.base
                        ? 'EDIT SNIPPET'
                        : 'NEW SNIPPET'}
                  </Dom>
                  <Dom scopeClass="snippet-scope-workspace" as="h1">
                    {c.editing.mode === 'append'
                      ? c.current
                        ? displayTitle(c.current.document)
                        : 'Add text'
                      : 'Your words, ready to read.'}
                  </Dom>
                </Dom>
                <Dom
                  scopeClass="snippet-scope-workspace"
                  as="div"
                  className={['actions'].filter(Boolean).join(' ')}
                >
                  <Button
                    variant={'ghost'}
                    disabled={c.busy || c.annotationPending}
                    onClick={() => c.action(() => c.closeEditor(false))}
                  >
                    {'Keep draft'}
                  </Button>
                  <Button
                    variant={'ghost'}
                    disabled={c.busy}
                    onClick={() => {
                      c.leaveTarget = c.editorReturn();
                      c.leaveOpen = true;
                    }}
                  >
                    {'Cancel'}
                  </Button>
                  <Button
                    disabled={c.busy || !c.EditorView || c.annotationPending}
                    onClick={() => c.action(c.save)}
                  >
                    {c.editing.mode === 'append' ? 'Append text' : 'Save snippet'}
                  </Button>
                </Dom>
              </Dom>
              {c.editing.mode !== 'append' ? (
                <>
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="label"
                    className={['title-label'].filter(Boolean).join(' ')}
                  >
                    {'Title '}
                    <Dom scopeClass="snippet-scope-workspace" as="span">
                      {'Optional · leave empty for an automatic title'}
                    </Dom>
                    <Input
                      aria-label={'Snippet title'}
                      value={c.title}
                      placeholder={c.automaticTitle}
                      maxLength={1000}
                      disabled={c.busy}
                      onInput={(event) => {
                        c.title = event.currentTarget.value;
                        void c.persist();
                      }}
                      className={['title-input min-h-11'].filter(Boolean).join(' ')}
                      bindings={{
                        value: (value) => {
                          c.title = value;
                        }
                      }}
                    ></Input>
                  </Dom>
                </>
              ) : null}
              <React.Fragment key={c.renderGeneration}>
                {c.EditorView ? (
                  <>
                    <DynamicComponent
                      this={c.EditorView}
                      content={c.content}
                      disabled={c.busy}
                      onchange={c.changedContent}
                      onpendingchange={(pending: boolean) => (c.annotationPending = pending)}
                      onready={(editor: Editor) => {
                        c.instance = editor;
                      }}
                    ></DynamicComponent>
                  </>
                ) : (
                  <>
                    {' '}
                    <Dom scopeClass="snippet-scope-workspace" as="p" role={'status'}>
                      {'Loading editor…'}
                    </Dom>
                  </>
                )}
              </React.Fragment>
              <Dom
                scopeClass="snippet-scope-workspace"
                as="div"
                className={['draft-footer'].filter(Boolean).join(' ')}
              >
                <Dom
                  scopeClass="snippet-scope-workspace"
                  as="p"
                  role={'status'}
                  className={[c.draftError && 'error'].filter(Boolean).join(' ')}
                >
                  {c.draftStatus}
                </Dom>
                {c.editing.mode !== 'append' ? (
                  <>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy || !!c.editing.base}
                      onClick={() => {
                        c.pickerPurpose = 'save';
                        c.pickerOpen = true;
                      }}
                    >
                      {c.destination
                        ? `Save to: ${c.providerName(c.destination.source.provider)} › ${c.destination.source.name} › ${c.destination.parent || 'Root'}`
                        : c.locationChosen
                          ? 'Save on this device only'
                          : 'Choose storage location…'}
                    </Button>
                  </>
                ) : null}
              </Dom>
              {c.editing.base && c.editing.mode === 'edit' ? (
                <>
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="p"
                    className={['muted'].filter(Boolean).join(' ')}
                  >
                    {
                      ' Changing storage for an existing document uses Move after saving. Cancel does not change the saved snippet. '
                    }
                  </Dom>
                </>
              ) : null}
              {c.editing.base ? (
                <>
                  <Button
                    variant={'ghost'}
                    disabled={c.busy}
                    onClick={() =>
                      c.action(async () => {
                        await c.persist();
                        const draft = c.snapshot();
                        if (draft) await c.newSnippet(c.content, draft.document);
                      })
                    }
                  >
                    {'Make this draft a new snippet…'}
                  </Button>
                </>
              ) : null}
              {c.draftError ? (
                <>
                  <Button
                    variant={'secondary'}
                    onClick={() =>
                      c.action(async () => {
                        const draft = c.snapshot();
                        if (draft) {
                          download(
                            'Recovered snippet.manabi-snippet.json',
                            encodeSnippet(draft.document)
                          );
                        }
                      })
                    }
                  >
                    {'Export unsaved draft'}
                  </Button>
                </>
              ) : null}
            </Dom>
          </>
        ) : (
          <>
            {' '}
            {c.current && c.admitted ? (
              <>
                <Dom
                  scopeClass="snippet-scope-workspace"
                  as="section"
                  aria-label={'Snippet reader'}
                  className={['reading'].filter(Boolean).join(' ')}
                >
                  <Button
                    href={resolve(c.libraryPath(c.params.get('returnTo')))}
                    variant={'link'}
                    size={'sm'}
                    className={['back h-auto min-h-[44px] px-0 py-[4px]'].filter(Boolean).join(' ')}
                  >
                    {'← Back to library'}
                  </Button>
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="div"
                    className={['heading'].filter(Boolean).join(' ')}
                  >
                    <Dom scopeClass="snippet-scope-workspace" as="div">
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="p"
                        className={['eyebrow'].filter(Boolean).join(' ')}
                      >
                        {c.current.document.trashedAt ? 'IN TRASH' : 'SNIPPET'}
                      </Dom>
                      <Dom scopeClass="snippet-scope-workspace" as="h1">
                        {displayTitle(c.current.document)}
                      </Dom>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="p"
                        role={'status'}
                        className={['muted'].filter(Boolean).join(' ')}
                      >
                        {saveLabel(c.current)}
                      </Dom>
                    </Dom>
                    <Dom
                      scopeClass="snippet-scope-workspace"
                      as="div"
                      className={['actions'].filter(Boolean).join(' ')}
                    >
                      {c.current.document.trashedAt ? (
                        <>
                          <Button
                            disabled={c.busy}
                            onClick={() =>
                              c.action(async () => {
                                await trashSnippet(c.current!.document.id, true, c.admitted);
                                await c.loadRecord(false);
                              })
                            }
                            className={['h-auto min-h-[44px] py-[6px]'].filter(Boolean).join(' ')}
                          >
                            {'Restore snippet'}
                          </Button>
                        </>
                      ) : (
                        <>
                          {' '}
                          <Button
                            disabled={
                              c.busy || !!c.current.transfer || !!c.current.conflicts.length
                            }
                            onClick={() => c.action(() => c.edit())}
                            className={['h-auto min-h-[44px] py-[6px]'].filter(Boolean).join(' ')}
                          >
                            {'Edit'}
                          </Button>
                          <Button
                            variant={'secondary'}
                            disabled={
                              c.busy || !!c.current.transfer || !!c.current.conflicts.length
                            }
                            onClick={() => c.action(() => c.edit('append'))}
                            className={['reader-add-wide h-auto min-h-[44px] py-[6px]']
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {'Add text'}
                          </Button>
                        </>
                      )}
                    </Dom>
                  </Dom>
                  {c.current.issue ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="p"
                        role={'status'}
                        className={['message'].filter(Boolean).join(' ')}
                      >
                        {c.current.issue}
                      </Dom>
                    </>
                  ) : null}
                  {c.current.transfer ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="div"
                        className={['message'].filter(Boolean).join(' ')}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="p">
                          {c.transferIssue ||
                            'A move is pending. Original and verified destination copies are preserved.'}
                        </Dom>
                        <Dom
                          scopeClass="snippet-scope-workspace"
                          as="div"
                          className={['actions'].filter(Boolean).join(' ')}
                        >
                          <Button
                            disabled={c.busy}
                            onClick={() =>
                              c.action(async () => {
                                await resumeTransfer(c.current!.document.id, c.admitted);
                                await c.loadRecord(false);
                              })
                            }
                          >
                            {'Resume move'}
                          </Button>
                          <Button
                            variant={'secondary'}
                            disabled={c.busy}
                            onClick={() =>
                              c.action(async () => {
                                await keepBoth(c.current!.document.id, c.admitted);
                                await c.loadRecord(false);
                              })
                            }
                          >
                            {'Keep both / cancel before copying'}
                          </Button>
                        </Dom>
                      </Dom>
                    </>
                  ) : null}
                  {c.current.conflicts.length ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="section"
                        aria-label={'Conflicting versions'}
                        className={['conflicts'].filter(Boolean).join(' ')}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="h2">
                          {'Choose the version to keep editing'}
                        </Dom>
                        <Dom scopeClass="snippet-scope-workspace" as="p">
                          {
                            'Other source files are not deleted. Export any version before resolving.'
                          }
                        </Dom>
                        {[c.current.document, ...c.current.conflicts].length
                          ? [c.current.document, ...c.current.conflicts].map((version, index) => (
                              <React.Fragment key={`${version.revision}:${index}`}>
                                <Dom scopeClass="snippet-scope-workspace" as="details">
                                  <Dom scopeClass="snippet-scope-workspace" as="summary">
                                    {index === 0 ? 'This device' : 'Other version'}
                                    {' · '}
                                    {new Date(version.modifiedAt).toLocaleString()}
                                  </Dom>
                                  <Dom scopeClass="snippet-scope-workspace" as="p">
                                    {passages(version.content)
                                      .map((p) => p.text)
                                      .join('\n')}
                                  </Dom>
                                  <Button
                                    disabled={c.busy}
                                    onClick={() => c.action(() => c.chooseVersion(version))}
                                  >
                                    {'Use this version'}
                                  </Button>
                                  <Button
                                    variant={'ghost'}
                                    disabled={c.busy}
                                    onClick={() =>
                                      c.action(async () => {
                                        download(filename(version), encodeSnippet(version));
                                      })
                                    }
                                  >
                                    {'Export version'}
                                  </Button>
                                </Dom>
                              </React.Fragment>
                            ))
                          : null}
                      </Dom>
                    </>
                  ) : null}
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="div"
                    className={['actions secondary secondary-actions-wide']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Button
                      variant={'ghost'}
                      disabled={c.busy || !!c.current.transfer}
                      onClick={() => c.membership([c.current!.document.id])}
                    >
                      {'Collections…'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy || !!c.current.transfer || !!c.current.conflicts.length}
                      onClick={() => c.move([c.current!.document.id])}
                    >
                      {'Move to…'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy}
                      onClick={() =>
                        c.action(() =>
                          c.newSnippet(c.current!.document.content, c.current!.document)
                        )
                      }
                    >
                      {'Duplicate'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy}
                      onClick={() =>
                        c.action(() => exportSnippets([c.current!.document.id], c.admitted))
                      }
                    >
                      {'Export JSON'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy}
                      onClick={() =>
                        c.action(() => exportSnippets([c.current!.document.id], c.admitted, 'html'))
                      }
                    >
                      {'HTML'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy}
                      onClick={() =>
                        c.action(() =>
                          exportSnippets([c.current!.document.id], c.admitted, 'markdown')
                        )
                      }
                    >
                      {'Markdown'}
                    </Button>
                    {!c.current.document.trashedAt ? (
                      <>
                        <Button
                          variant={'ghost'}
                          disabled={c.busy || !!c.current.transfer}
                          onClick={() => {
                            c.deleteIds = [c.current!.document.id];
                            c.deleteOpen = true;
                          }}
                        >
                          {'Trash'}
                        </Button>
                      </>
                    ) : null}
                  </Dom>
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="div"
                    className={['secondary-actions-menu'].filter(Boolean).join(' ')}
                  >
                    <Menu.Root>
                      <Menu.Trigger
                        child={({ props }: { props: Record<string, any> }) => (
                          <>
                            <Button
                              {...props}
                              variant={'secondary'}
                              className={['h-auto min-h-[44px] py-[6px]'].filter(Boolean).join(' ')}
                            >
                              {'More actions'}
                            </Button>
                          </>
                        )}
                      ></Menu.Trigger>
                      <Menu.Content
                        align={'start'}
                        collisionPadding={8}
                        className={['w-64 max-w-[calc(100vw-1rem)]'].filter(Boolean).join(' ')}
                      >
                        <Menu.Item
                          disabled={c.busy || !!c.current.transfer}
                          onSelect={() => c.membership([c.current!.document.id])}
                        >
                          {' Collections… '}
                        </Menu.Item>
                        {!c.current.document.trashedAt ? (
                          <>
                            <Menu.Item
                              disabled={
                                c.busy || !!c.current.transfer || !!c.current.conflicts.length
                              }
                              onSelect={() => c.action(() => c.edit('append'))}
                            >
                              {'Add text'}
                            </Menu.Item>
                          </>
                        ) : null}
                        <Menu.Item
                          disabled={c.busy || !!c.current.transfer || !!c.current.conflicts.length}
                          onSelect={() => c.move([c.current!.document.id])}
                        >
                          {' Move to… '}
                        </Menu.Item>
                        <Menu.Item
                          disabled={c.busy}
                          onSelect={() =>
                            c.action(() =>
                              c.newSnippet(c.current!.document.content, c.current!.document)
                            )
                          }
                        >
                          {' Duplicate '}
                        </Menu.Item>
                        <Menu.Separator></Menu.Separator>
                        <Menu.Item
                          disabled={c.busy}
                          onSelect={() =>
                            c.action(() => exportSnippets([c.current!.document.id], c.admitted))
                          }
                        >
                          {' Export JSON '}
                        </Menu.Item>
                        <Menu.Item
                          disabled={c.busy}
                          onSelect={() =>
                            c.action(() =>
                              exportSnippets([c.current!.document.id], c.admitted, 'html')
                            )
                          }
                        >
                          {' HTML '}
                        </Menu.Item>
                        <Menu.Item
                          disabled={c.busy}
                          onSelect={() =>
                            c.action(() =>
                              exportSnippets([c.current!.document.id], c.admitted, 'markdown')
                            )
                          }
                        >
                          {' Markdown '}
                        </Menu.Item>
                        {!c.current.document.trashedAt ? (
                          <>
                            <Menu.Separator></Menu.Separator>
                            <Menu.Item
                              disabled={c.busy || !!c.current.transfer}
                              onSelect={() => {
                                c.deleteIds = [c.current!.document.id];
                                c.deleteOpen = true;
                              }}
                            >
                              {' Trash '}
                            </Menu.Item>
                          </>
                        ) : null}
                      </Menu.Content>
                    </Menu.Root>
                  </Dom>
                  {c.current.destination ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="details"
                        className={['locations'].filter(Boolean).join(' ')}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="summary">
                          {'Storage location'}
                          {c.current.locations.length > 1 ? 's' : ''}
                        </Dom>
                        {(c.current.locations ?? []).length
                          ? (c.current.locations ?? []).map((location, _index0) => (
                              <React.Fragment
                                key={JSON.stringify([
                                  location.source.id,
                                  location.source.root,
                                  location.fileId
                                ])}
                              >
                                <Dom scopeClass="snippet-scope-workspace" as="p">
                                  {c.providerName(location.source.provider)}
                                  {' › '}
                                  {location.source.name}
                                  {' › '}
                                  {location.parent || 'Root'}
                                  {' › '}
                                  {location.name}
                                  {location.missing ? ' · missing' : ''}
                                </Dom>
                              </React.Fragment>
                            ))
                          : null}
                        {!c.current.locations.length ? (
                          <>
                            <Dom scopeClass="snippet-scope-workspace" as="p">
                              {' Pending: '}
                              {c.providerName(c.current.destination.source.provider)}
                              {' › '}
                              {c.current.destination.parent || 'Root'}
                            </Dom>
                          </>
                        ) : null}
                      </Dom>
                    </>
                  ) : null}
                  <React.Fragment key={c.current.document.id + c.current.document.revision}>
                    <SnippetReader
                      document={c.current.document}
                      selectedScope={c.admitted}
                      locator={c.locator ?? c.current.progress}
                      followRemotePosition={!c.locator}
                    ></SnippetReader>
                  </React.Fragment>
                  {c.current.document.source ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="p"
                        className={['source'].filter(Boolean).join(' ')}
                      >
                        {' Captured from '}
                        {c.current.document.source.title}
                        {c.sourceSnippetId ? (
                          <>
                            {'· '}
                            <Dom
                              scopeClass="snippet-scope-workspace"
                              as="a"
                              href={resolve(`/snippets?id=${c.sourceSnippetId}`)}
                            >
                              {'Open source'}
                            </Dom>
                          </>
                        ) : (
                          <>
                            {' '}
                            {c.current.document.source.url ? (
                              <>
                                {'· '}
                                <Dom
                                  scopeClass="snippet-scope-workspace"
                                  as="a"
                                  href={c.current.document.source.url}
                                  target={'_blank'}
                                  rel={'external noopener noreferrer'}
                                >
                                  {'Open source'}
                                </Dom>
                              </>
                            ) : null}
                          </>
                        )}
                      </Dom>
                    </>
                  ) : null}
                </Dom>
              </>
            ) : (
              <>
                {' '}
                <Dom
                  scopeClass="snippet-scope-workspace"
                  as="section"
                  aria-label={'Snippets library'}
                  className={['library'].filter(Boolean).join(' ')}
                >
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="div"
                    className={['heading'].filter(Boolean).join(' ')}
                  >
                    <Dom scopeClass="snippet-scope-workspace" as="div">
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="p"
                        className={['eyebrow'].filter(Boolean).join(' ')}
                      >
                        {'YOUR LIBRARY'}
                      </Dom>
                      <Dom scopeClass="snippet-scope-workspace" as="h1">
                        {c.trashed ? 'Snippet Trash' : (c.collection?.name ?? 'Snippets')}
                      </Dom>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="p"
                        className={['muted'].filter(Boolean).join(' ')}
                      >
                        {'Short texts, together across your connected storage.'}
                      </Dom>
                    </Dom>
                    <Dom
                      scopeClass="snippet-scope-workspace"
                      as="div"
                      className={['actions'].filter(Boolean).join(' ')}
                    >
                      <Button
                        disabled={c.busy || !c.admitted}
                        onClick={() => c.action(() => c.newSnippet())}
                      >
                        {'New snippet'}
                      </Button>
                      <Button
                        variant={'secondary'}
                        disabled={c.busy || !c.admitted}
                        onClick={() => c.action(() => c.paste())}
                      >
                        {'Paste'}
                      </Button>
                    </Dom>
                  </Dom>
                  {c.id && !c.current ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="p"
                        role={'status'}
                        className={['message'].filter(Boolean).join(' ')}
                      >
                        {
                          ' This snippet is not available in the current account yet. Refresh connected sources or return to the list. '
                        }
                      </Dom>
                    </>
                  ) : null}
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="div"
                    className={['search-row'].filter(Boolean).join(' ')}
                  >
                    <Dom
                      scopeClass="snippet-scope-workspace"
                      as="label"
                      className={['search-label'].filter(Boolean).join(' ')}
                    >
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="span"
                        className={['sr-only'].filter(Boolean).join(' ')}
                      >
                        {'Search snippets'}
                      </Dom>
                      <Input
                        type={'search'}
                        aria-label={'Search snippets'}
                        placeholder={'Search titles and content'}
                        aria-invalid={snippetSearchTooLong(c.query) ? true : undefined}
                        aria-describedby={
                          snippetSearchTooLong(c.query) ? 'snippet-search-limit-error' : undefined
                        }
                        value={c.query}
                        onInput={(event) => {
                          c.query = event.currentTarget.value;
                          c.updateQuery();
                        }}
                        className={['min-h-11 w-full px-4 text-base'].filter(Boolean).join(' ')}
                        bindings={{
                          value: (value) => {
                            c.query = value;
                          }
                        }}
                      ></Input>
                    </Dom>
                    <Dom
                      scopeClass="snippet-scope-workspace"
                      as="div"
                      role={'group'}
                      aria-label={'Search scope'}
                      className={['actions'].filter(Boolean).join(' ')}
                    >
                      <Button variant={'secondary'} aria-pressed={true}>
                        {'Snippets'}
                      </Button>
                      <Button
                        variant={'ghost'}
                        href={`${base}/manage?${new URLSearchParams({ q: c.query, scope: 'all' })}`}
                      >
                        {'All Library'}
                      </Button>
                    </Dom>
                  </Dom>
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="div"
                    className={['filters'].filter(Boolean).join(' ')}
                  >
                    <Dom scopeClass="snippet-scope-workspace" as="label">
                      {'Location'}
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="select"
                        aria-label={'Snippet source'}
                        value={c.source}
                        bindings={{
                          value: (value) => {
                            c.source = value;
                          }
                        }}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={''}>
                          {'All sources'}
                        </Dom>
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={'device'}>
                          {'On this device only'}
                        </Dom>
                        {(c.sources ?? []).length
                          ? (c.sources ?? []).map(([key, name], _index1) => (
                              <React.Fragment key={key}>
                                <Dom scopeClass="snippet-scope-workspace" as="option" value={key}>
                                  {name}
                                </Dom>
                              </React.Fragment>
                            ))
                          : null}
                      </Dom>
                    </Dom>
                    <Dom scopeClass="snippet-scope-workspace" as="label">
                      {'Sort'}
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="select"
                        aria-label={'Sort snippets'}
                        value={c.sort}
                        bindings={{
                          value: (value) => {
                            c.sort = value;
                          }
                        }}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={'edited'}>
                          {'Last edited'}
                        </Dom>
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={'read'}>
                          {'Recently read'}
                        </Dom>
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={'created'}>
                          {'Date created'}
                        </Dom>
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={'title'}>
                          {'Title'}
                        </Dom>
                      </Dom>
                    </Dom>
                    <Dom scopeClass="snippet-scope-workspace" as="label">
                      {'View'}
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="select"
                        aria-label={'Snippet view'}
                        value={c.layout}
                        bindings={{
                          value: (value) => {
                            c.layout = value;
                          }
                        }}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={'list'}>
                          {'List'}
                        </Dom>
                        <Dom scopeClass="snippet-scope-workspace" as="option" value={'grid'}>
                          {'Cards'}
                        </Dom>
                      </Dom>
                    </Dom>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy}
                      onClick={() => {
                        c.selecting = !c.selecting;
                        c.selected = new Set();
                      }}
                    >
                      {c.selecting ? 'Done selecting' : 'Select'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy || !c.admitted}
                      onClick={() => c.action(() => refreshSnippets(c.admitted, true))}
                    >
                      {'Refresh sources'}
                    </Button>
                    <Button variant={'ghost'} href={c.listURL({ trash: c.trashed ? '' : '1' })}>
                      {c.trashed ? 'All snippets' : 'Trash'}
                    </Button>
                  </Dom>
                  {c.$snippetStatus.busy || c.$snippetStatus.remaining ? (
                    <>
                      <Dom scopeClass="snippet-scope-workspace" as="p" role={'status'}>
                        {' Indexing connected snippets… '}
                        {c.$snippetStatus.remaining}
                        {' remaining. Already indexed text is searchable. '}
                      </Dom>
                    </>
                  ) : null}
                  {c.$snippetStatus.issues.length ? (
                    <>
                      <Dom scopeClass="snippet-scope-workspace" as="details">
                        <Dom scopeClass="snippet-scope-workspace" as="summary">
                          {'Source notices ('}
                          {c.$snippetStatus.issues.length}
                          {')'}
                        </Dom>
                        {(c.$snippetStatus.issues ?? []).length
                          ? (c.$snippetStatus.issues ?? []).map((problem, index) => (
                              <React.Fragment key={index}>
                                <Dom
                                  scopeClass="snippet-scope-workspace"
                                  as="p"
                                  className={['muted'].filter(Boolean).join(' ')}
                                >
                                  {problem}
                                </Dom>
                              </React.Fragment>
                            ))
                          : null}
                      </Dom>
                    </>
                  ) : null}
                  {c.selecting ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="div"
                        role={'toolbar'}
                        aria-label={'Selected snippet actions'}
                        className={['batch'].filter(Boolean).join(' ')}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="strong">
                          {c.selected.size}
                          {' selected'}
                        </Dom>
                        <Button
                          variant={'secondary'}
                          onClick={() => (c.selected = new Set(c.visibleIds))}
                        >
                          {'Select all visible'}
                        </Button>
                        <Button
                          variant={'ghost'}
                          disabled={!c.selected.size || c.busy}
                          onClick={() => c.membership([...c.selected])}
                        >
                          {'Collections…'}
                        </Button>
                        <Button
                          variant={'ghost'}
                          disabled={!c.selected.size || c.busy}
                          onClick={() => c.move([...c.selected])}
                        >
                          {'Move to…'}
                        </Button>
                        <Button
                          variant={'ghost'}
                          disabled={!c.selected.size || c.busy}
                          onClick={() =>
                            c.action(() => exportSnippets([...c.selected], c.admitted))
                          }
                        >
                          {'Export selected'}
                        </Button>
                        {c.trashed ? (
                          <>
                            <Button
                              variant={'ghost'}
                              disabled={!c.selected.size || c.busy}
                              onClick={() =>
                                c.action(async () => {
                                  for (const id of c.selected)
                                    await trashSnippet(id, true, c.admitted);
                                  c.selected = new Set();
                                })
                              }
                            >
                              {'Restore'}
                            </Button>
                          </>
                        ) : (
                          <>
                            {' '}
                            <Button
                              variant={'ghost'}
                              disabled={!c.selected.size || c.busy}
                              onClick={() => {
                                c.deleteIds = [...c.selected];
                                c.deleteOpen = true;
                              }}
                            >
                              {'Move to Trash'}
                            </Button>
                          </>
                        )}
                      </Dom>
                    </>
                  ) : null}
                  <Shelf
                    query={c.query}
                    source={c.source}
                    layout={c.layout}
                    sort={c.sort}
                    trashed={c.trashed}
                    members={c.collection?.members}
                    selecting={c.selecting}
                    selected={c.selected}
                    onselect={c.selection}
                    onvisible={(ids) => {
                      c.visibleIds = ids;
                      c.selected = new Set([...c.selected].filter((id) => ids.includes(id)));
                    }}
                    returnTo={c.routeURL}
                  ></Shelf>
                  {c.storedDrafts.length ? (
                    <>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="section"
                        aria-label={'Recovered snippet drafts'}
                        className={['drafts'].filter(Boolean).join(' ')}
                      >
                        <Dom scopeClass="snippet-scope-workspace" as="h2">
                          {'Continue a draft'}
                        </Dom>
                        <Dom
                          scopeClass="snippet-scope-workspace"
                          as="p"
                          className={['muted'].filter(Boolean).join(' ')}
                        >
                          {'Drafts stay on this device and are not included in library search.'}
                        </Dom>
                        {(c.storedDrafts ?? []).length
                          ? (c.storedDrafts ?? []).map((draft, _index2) => (
                              <React.Fragment key={draft.key}>
                                <Dom
                                  scopeClass="snippet-scope-workspace"
                                  as="div"
                                  className={['draft'].filter(Boolean).join(' ')}
                                >
                                  <Dom
                                    scopeClass="snippet-scope-workspace"
                                    as="a"
                                    href={resolve(`/snippets?draft=${draft.session}`)}
                                  >
                                    {displayTitle(draft.document)}
                                    <Dom scopeClass="snippet-scope-workspace" as="span">
                                      {'· '}
                                      {draft.mode ?? 'new'}
                                      {' · '}
                                      {new Date(draft.updatedAt).toLocaleString()}
                                    </Dom>
                                  </Dom>
                                  <Button
                                    variant={'ghost'}
                                    disabled={c.busy}
                                    onClick={() =>
                                      c.action(async () => {
                                        if (!c.admitted) return;
                                        await deleteDraft(draft.key, c.admitted.guard);
                                        c.storedDrafts = await drafts(c.admitted.owner);
                                      })
                                    }
                                  >
                                    {'Discard draft'}
                                  </Button>
                                </Dom>
                              </React.Fragment>
                            ))
                          : null}
                      </Dom>
                    </>
                  ) : null}
                  <Dom
                    scopeClass="snippet-scope-workspace"
                    as="footer"
                    className={['actions library-footer'].filter(Boolean).join(' ')}
                  >
                    <Dom
                      scopeClass="snippet-scope-workspace"
                      as="input"
                      type={'file'}
                      accept={'.manabi-snippet.json,.manabi-snippets.json,.txt,.md,.html,.htm'}
                      elementRef={(value) => {
                        c.importInput = value;
                      }}
                      onChange={() => {
                        const file = c.importInput.files?.[0];
                        c.importInput.value = '';
                        if (file) void c.action(() => c.importFile(file));
                      }}
                      className={['sr-only'].filter(Boolean).join(' ')}
                    />
                    <Button
                      variant={'ghost'}
                      disabled={c.busy || !c.admitted}
                      onClick={() => c.importInput.click()}
                    >
                      {'Import text or backup…'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy || !c.admitted}
                      onClick={() => c.action(() => c.paste('markdown'))}
                    >
                      {'Paste as Markdown'}
                    </Button>
                    <Button
                      variant={'ghost'}
                      disabled={c.busy || !c.admitted}
                      onClick={() => {
                        c.pickerPurpose = 'default';
                        c.pickerOpen = true;
                      }}
                    >
                      {'Default save location…'}
                    </Button>
                    <Button
                      href={resolve('/connections')}
                      variant={'link'}
                      size={'sm'}
                      className={['min-h-11 px-0'].filter(Boolean).join(' ')}
                    >
                      {'Manage connected libraries'}
                    </Button>
                  </Dom>
                </Dom>
              </>
            )}
          </>
        )}
      </Dom>
      {c.pickerOpen && c.admitted ? (
        <>
          <Dialog.Root
            open={c.pickerOpen}
            bindings={{
              open: (value) => {
                c.pickerOpen = value;
              }
            }}
          >
            <Dialog.Content
              closeDisabled={c.busy || c.pickerWriteBusy}
              className={['overflow-hidden p-0'].filter(Boolean).join(' ')}
            >
              <Dom
                scopeClass="snippet-scope-workspace"
                as="div"
                data-snippet-picker-scroll={true}
                className={['max-h-[inherit] min-h-0 overflow-y-auto overscroll-contain p-[24px]']
                  .filter(Boolean)
                  .join(' ')}
              >
                <Dialog.Header className={['pe-[48px]'].filter(Boolean).join(' ')}>
                  <Dialog.Title>
                    {c.pickerPurpose === 'move'
                      ? 'Move snippets'
                      : c.pickerPurpose === 'default'
                        ? 'Default snippet location'
                        : 'Save location'}
                  </Dialog.Title>
                  <Dialog.Description>
                    {
                      'Choose one real storage home. Your documents remain together in the Snippets view.'
                    }
                  </Dialog.Description>
                </Dialog.Header>
                <DestinationPicker
                  initial={c.destination ?? c.current?.destination}
                  guard={c.admitted.guard}
                  allowDevice={c.pickerPurpose === 'save'}
                  allowUnsetDefault={c.pickerPurpose === 'default'}
                  onwritebusy={(value) => (c.pickerWriteBusy = value)}
                  choose={(value, remember) =>
                    void c.action(() => c.chooseDestination(value, remember))
                  }
                ></DestinationPicker>
              </Dom>
            </Dialog.Content>
          </Dialog.Root>
        </>
      ) : null}
      {c.collectionsOpen ? (
        <>
          <Dialog.Root
            open={c.collectionsOpen}
            bindings={{
              open: (value) => {
                c.collectionsOpen = value;
              }
            }}
          >
            <Dialog.Content closeDisabled={c.busy}>
              <Dialog.Header>
                <Dialog.Title>{'Add to collections'}</Dialog.Title>
                <Dialog.Description>
                  {'Collection membership does not move the underlying files.'}
                </Dialog.Description>
              </Dialog.Header>
              {(c.$organization.collections ?? []).length
                ? (c.$organization.collections ?? []).map((collection, _index3) => (
                    <React.Fragment key={collection.id}>
                      <Dom
                        scopeClass="snippet-scope-workspace"
                        as="label"
                        className={['membership'].filter(Boolean).join(' ')}
                      >
                        <Dom
                          scopeClass="snippet-scope-workspace"
                          as="input"
                          type={'checkbox'}
                          checked={c.collectionTargets.every((id) =>
                            collection.members.includes(id)
                          )}
                          disabled={c.busy}
                          onChange={(event) =>
                            void c.action(() =>
                              c.toggleCollection(collection.id, event.currentTarget.checked)
                            )
                          }
                          className={['size-5 accent-primary'].filter(Boolean).join(' ')}
                        />
                        {collection.name}
                      </Dom>
                    </React.Fragment>
                  ))
                : null}
              <Dom
                scopeClass="snippet-scope-workspace"
                as="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void c.action(c.addCollection);
                }}
              >
                <Dom scopeClass="snippet-scope-workspace" as="label">
                  {'New collection'}
                  <Input
                    aria-label={'New collection name'}
                    value={c.newCollection}
                    maxLength={240}
                    className={['min-h-11'].filter(Boolean).join(' ')}
                    bindings={{
                      value: (value) => {
                        c.newCollection = value;
                      }
                    }}
                  ></Input>
                </Dom>
                <Button type={'submit'} disabled={c.busy || !c.newCollection.trim()}>
                  {'Create collection'}
                </Button>
              </Dom>
              <Button
                variant={'secondary'}
                disabled={c.busy}
                onClick={() => (c.collectionsOpen = false)}
              >
                {'Done'}
              </Button>
            </Dialog.Content>
          </Dialog.Root>
        </>
      ) : null}
      {c.deleteOpen ? (
        <>
          <Dialog.Root
            open={c.deleteOpen}
            bindings={{
              open: (value) => {
                c.deleteOpen = value;
              }
            }}
          >
            <Dialog.Content closeDisabled={c.busy}>
              <Dialog.Header>
                <Dialog.Title>
                  {'Move '}
                  {c.deleteIds.length}
                  {' snippet'}
                  {c.deleteIds.length === 1 ? '' : 's'}
                  {' to Trash?'}
                </Dialog.Title>
                <Dialog.Description>
                  {
                    'This saves a recoverable trash state in each document. Collections and other copies are not deleted.'
                  }
                </Dialog.Description>
              </Dialog.Header>
              <Button
                variant={'destructive'}
                disabled={c.busy}
                onClick={() => c.action(c.removeSelected)}
              >
                {'Move to Trash'}
              </Button>
              <Button variant={'ghost'} disabled={c.busy} onClick={() => (c.deleteOpen = false)}>
                {'Cancel'}
              </Button>
            </Dialog.Content>
          </Dialog.Root>
        </>
      ) : null}
      {c.leaveOpen ? (
        <>
          <Dialog.Root
            open={c.leaveOpen}
            bindings={{
              open: (value) => {
                c.leaveOpen = value;
              }
            }}
          >
            <Dialog.Content closeDisabled={c.busy}>
              <Dialog.Header>
                <Dialog.Title>{'Keep this draft?'}</Dialog.Title>
                <Dialog.Description>
                  {
                    'The saved snippet has not changed. Keep the draft on this device or discard these edits.'
                  }
                </Dialog.Description>
              </Dialog.Header>
              <Button
                disabled={c.busy || c.annotationPending}
                onClick={() => c.action(() => c.leave(false))}
              >
                {'Keep draft and leave'}
              </Button>
              <Button
                variant={'destructive'}
                disabled={c.busy}
                onClick={() => c.action(() => c.leave(true))}
              >
                {'Discard draft and leave'}
              </Button>
              <Button variant={'ghost'} disabled={c.busy} onClick={() => (c.leaveOpen = false)}>
                {'Continue editing'}
              </Button>
            </Dialog.Content>
          </Dialog.Root>
        </>
      ) : null}
    </ReaderScope>
  );
}
