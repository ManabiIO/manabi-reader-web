/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Fragment, type ReactNode } from 'react';
/**
 * React/controller port of lib/components/book-card/book-manager-header.svelte; transactions retain their original guards.
 */
import { openUserGuide } from '$lib/components/navigation/docs-link';

import { resolve } from '$app/paths';
import { goto } from '$app/navigation';

import { SortDirection } from '$lib/data/sort-types';

import { StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { booklistSortOptions$, fileCountData$, isOnline$ } from '$lib/data/store';

import { inputFile } from '$lib/functions/file-dom/input-file';
import { isMobile$ } from '$lib/functions/utils';

import { HeaderController } from './header-controller';
import { readStore } from './observable-controller';
import { Action, Button, Menu } from './primitives';
import {
  ArrowLeft,
  BookmarkSimple,
  BookOpen,
  Books,
  Bug,
  CalendarBlank,
  ChartBar,
  Cloud,
  DotsThree as MoreHorizontal,
  FileArrowUp,
  FolderOpen,
  FolderPlus,
  Gear,
  List,
  MagnifyingGlass as Search,
  TextAlignLeft as CollectionsList,
  SelectionAll,
  SquaresFour,
  UserCircle,
  X
} from '@phosphor-icons/react';
import { AppNav, ActionMenu } from './navigation';
export function HeaderView({
  c,
  children: _children
}: {
  c: HeaderController;
  children?: ReactNode;
}) {
  return (
    <>
      <Action
        hidden={true}
        multiple={true}
        type={'file'}
        accept={'application/epub+zip,.epub,.epub.zip,.htmlz,plain/text,.txt'}
        ref={(element: any) => {
          c.fileImportElm = element;
        }}
        as={'input'}
        action={inputFile}
        options={c.filesChanged}
      />
      <Action
        hidden={true}
        multiple={true}
        type={'file'}
        ref={(element: any) => {
          c.folderImportElm = element;
          if (element) {
            element.setAttribute('webkitdirectory', '');
            element.setAttribute('directory', '');
          }
        }}
        as={'input'}
        action={inputFile}
        options={c.filesChanged}
      />
      <Action
        hidden={true}
        type={'file'}
        accept={'.zip,application/zip'}
        ref={(element: any) => {
          c.backupImportElm = element;
        }}
        as={'input'}
        action={inputFile}
        options={c.backupChanged}
      />
      <Action
        hidden={true}
        type={'file'}
        accept={'.json,application/json'}
        ref={(element: any) => {
          c.countImportElm = element;
        }}
        as={'input'}
        action={inputFile}
        options={c.setCountData}
      />
      {c.modernLibrary ? (
        <>
          <header
            aria-label={'Library toolbar'}
            className={['floating-library-header text-foreground lg:ml-[16rem]']
              .filter(Boolean)
              .join(' ')}
          >
            <div
              className={[
                c.selectMode && c.compactLibrary ? 'hidden' : '',
                'library-header-inner flex min-h-16 items-center justify-between gap-2 py-2'
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {c.compactLibrary && (c.searchExpanded || !!c.libraryMenu?.search.query) ? (
                <>
                  <form
                    role={'search'}
                    onSubmit={(event: any) => event.preventDefault()}
                    className={['flex min-w-0 flex-1 items-center gap-2'].filter(Boolean).join(' ')}
                  >
                    <label
                      className={[
                        'flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-full bg-muted px-2 focus-within:ring-2 focus-within:ring-ring min-[390px]:gap-2 min-[390px]:px-3'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <Search
                        weight={'bold'}
                        aria-hidden={'true'}
                        className={['hidden size-6 shrink-0 min-[390px]:block']
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <span className={['sr-only'].filter(Boolean).join(' ')}>
                        {'Search library'}
                      </span>
                      <input
                        type={'search'}
                        disabled={!c.hydrated || !c.libraryMenu}
                        placeholder={'Search dictionary and library'}
                        onInput={c.searchInputChanged}
                        onCompositionStart={c.searchCompositionStarted}
                        onCompositionEnd={c.searchCompositionEnded}
                        onBlur={c.searchInputBlurred}
                        onKeyDown={(event: any) => {
                          if (event.isComposing || event.keyCode === 229) return;
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            void c.closeSearch();
                          }
                        }}
                        ref={(element: any) => {
                          c.searchInput = element;
                        }}
                        value={c.searchDraft}
                        onChange={(event: any) => {
                          c.searchDraft = event.currentTarget.value;
                        }}
                        className={[
                          'w-full min-w-0 border-0 bg-transparent p-0 shadow-none outline-none focus:border-transparent focus:shadow-none focus:ring-0'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                    </label>
                    <Button
                      variant={'ghost'}
                      onClick={c.closeSearch}
                      className={['min-h-11 px-2 min-[390px]:px-4'].filter(Boolean).join(' ')}
                    >
                      {'Cancel'}
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  <div className={['flex min-w-0 items-center gap-2'].filter(Boolean).join(' ')}>
                    {c.libraryMenu?.canGoBack ? (
                      <>
                        <Button
                          variant={'ghost'}
                          size={'icon'}
                          aria-label={'Back'}
                          title={'Back'}
                          onClick={() => c.libraryMenu?.back()}
                          className={['size-11 shrink-0 rounded-full'].filter(Boolean).join(' ')}
                        >
                          <ArrowLeft
                            weight={'bold'}
                            aria-hidden={'true'}
                            className={['size-6'].filter(Boolean).join(' ')}
                          />
                        </Button>
                        <h1
                          className={['truncate text-base font-semibold tracking-tight sm:text-2xl']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {c.title}
                        </h1>
                      </>
                    ) : (
                      <>
                        <h1
                          className={[
                            'flex min-w-0 flex-wrap gap-x-1 text-sm leading-tight font-semibold tracking-tight min-[390px]:text-base sm:text-xl'
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className={['whitespace-nowrap'].filter(Boolean).join(' ')}>
                            {'Manabi Reader'}
                          </span>
                          <span
                            className={['font-normal whitespace-nowrap text-muted-foreground']
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {'for Web'}
                          </span>
                        </h1>
                      </>
                    )}
                  </div>
                  <div className={['flex shrink-0 items-center gap-1.5'].filter(Boolean).join(' ')}>
                    {c.compactLibrary ? (
                      <>
                        <Button
                          variant={'outline'}
                          size={'icon'}
                          aria-label={'Search library'}
                          title={'Search library'}
                          onClick={c.openSearch}
                          disabled={!c.hydrated || !c.libraryMenu || !!c.replicationToProgress}
                          ref={(element: any) => {
                            c.searchButton = element;
                          }}
                          className={['size-11 rounded-full lg:hidden'].filter(Boolean).join(' ')}
                        >
                          <Search
                            weight={'bold'}
                            aria-hidden={'true'}
                            className={['size-6'].filter(Boolean).join(' ')}
                          />
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant={'outline'}
                      size={'icon'}
                      aria-label={'Collections'}
                      title={'Collections'}
                      aria-expanded={c.collectionsExpanded}
                      aria-haspopup={'dialog'}
                      aria-controls={'library-collections-sheet'}
                      onClick={() => c.dispatch('collectionsClick')}
                      disabled={!!c.replicationToProgress}
                      className={['size-11 rounded-full lg:hidden'].filter(Boolean).join(' ')}
                    >
                      <CollectionsList
                        weight={'bold'}
                        aria-hidden={'true'}
                        className={['size-6'].filter(Boolean).join(' ')}
                      />
                    </Button>
                    <Menu.Root>
                      <Menu.Trigger
                        child={({ props }: { props: Record<string, any> }) => (
                          <>
                            <Button
                              {...props}
                              variant={'outline'}
                              size={'icon'}
                              aria-label={'Library actions'}
                              title={'Library actions'}
                              disabled={!!c.replicationToProgress}
                              ref={(element: any) => {
                                c.libraryActionsButton = element;
                              }}
                              className={['size-11 rounded-full'].filter(Boolean).join(' ')}
                            >
                              <MoreHorizontal
                                weight={'bold'}
                                aria-hidden={'true'}
                                className={['size-7'].filter(Boolean).join(' ')}
                              />
                            </Button>
                          </>
                        )}
                      />
                      <Menu.Content
                        align={'end'}
                        className={[
                          'library-menu max-h-[min(80dvh,40rem)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {c.hasBookOpened ? (
                          <>
                            <Menu.Item onSelect={() => c.dispatch('backToBookClick')}>
                              <Books aria-hidden={'true'} />
                              {'Resume Reading'}
                            </Menu.Item>
                            <Menu.Separator />
                          </>
                        ) : null}
                        <Menu.Item disabled={!c.hasBooks} onSelect={c.enterSelectionMode}>
                          <SelectionAll aria-hidden={'true'} />
                          {'Select Books'}
                        </Menu.Item>
                        <Menu.Sub>
                          <Menu.SubTrigger>
                            <FolderPlus aria-hidden={'true'} />
                            {'Add Books'}
                          </Menu.SubTrigger>
                          <Menu.SubContent
                            side={c.compactMenus.current ? 'bottom' : 'right'}
                            align={'end'}
                            collisionPadding={8}
                            className={['library-menu w-64'].filter(Boolean).join(' ')}
                          >
                            <Menu.Item onSelect={() => c.fileImportElm?.click()}>
                              <FileArrowUp aria-hidden={'true'} />
                              {'Import File(s)'}
                            </Menu.Item>
                            {!readStore(isMobile$) ? (
                              <>
                                <Menu.Item onSelect={() => c.folderImportElm?.click()}>
                                  <FolderPlus aria-hidden={'true'} />
                                  {'Import Folder(s)'}
                                </Menu.Item>
                              </>
                            ) : null}
                            <Menu.Item onSelect={() => c.backupImportElm?.click()}>
                              {'Import Backup'}
                            </Menu.Item>
                            <Menu.Separator />
                            <Menu.Item onSelect={() => goto(resolve('/import-ttu'))}>
                              {'Import from Ttu Ebook Reader'}
                            </Menu.Item>
                            <Menu.Item onSelect={() => goto(resolve('/import-ttu?source=yatsu'))}>
                              {'Import from Yatsu Reader'}
                            </Menu.Item>
                            <Menu.Separator />
                            <Menu.Item onSelect={() => c.dispatch('editorsPicksClick')}>
                              <BookOpen aria-hidden={'true'} />
                              {"Editor's Picks"}
                            </Menu.Item>
                          </Menu.SubContent>
                        </Menu.Sub>
                        {c.libraryMenu ? (
                          <>
                            <Menu.Sub>
                              <Menu.SubTrigger>
                                <SquaresFour aria-hidden={'true'} />
                                {'View Options'}
                              </Menu.SubTrigger>
                              <Menu.SubContent
                                side={c.compactMenus.current ? 'bottom' : 'right'}
                                align={'end'}
                                collisionPadding={8}
                                className={['library-menu w-64'].filter(Boolean).join(' ')}
                              >
                                <Menu.RadioGroup
                                  value={c.libraryMenu.currentLayout}
                                  onValueChange={c.libraryMenu.setLayout}
                                >
                                  {c.libraryMenu.layouts.map((choice, __index) => (
                                    <Fragment key={choice.value}>
                                      <Menu.RadioItem value={choice.value}>
                                        {choice.icon === 'grid' ? (
                                          <>
                                            <SquaresFour aria-hidden={'true'} />
                                          </>
                                        ) : (
                                          <>
                                            {choice.icon === 'list' ? (
                                              <>
                                                <List aria-hidden={'true'} />
                                              </>
                                            ) : (
                                              <>
                                                <CalendarBlank aria-hidden={'true'} />
                                              </>
                                            )}
                                          </>
                                        )}
                                        {choice.label}
                                      </Menu.RadioItem>
                                    </Fragment>
                                  ))}
                                </Menu.RadioGroup>
                                <Menu.Separator />
                                <Menu.Label>{'Show'}</Menu.Label>
                                <Menu.RadioGroup
                                  value={c.libraryMenu.showValue}
                                  onValueChange={c.libraryMenu.setShow}
                                >
                                  {c.libraryMenu.showChoices.map((choice, __index) => (
                                    <Fragment key={choice.value}>
                                      <Menu.RadioItem
                                        value={choice.value}
                                        disabled={(c.libraryMenu?.showChoices.length ?? 0) <= 1}
                                      >
                                        {choice.label}
                                      </Menu.RadioItem>
                                    </Fragment>
                                  ))}
                                </Menu.RadioGroup>
                                <Menu.Separator />
                                <Menu.Sub>
                                  <Menu.SubTrigger>{'Sort by…'}</Menu.SubTrigger>
                                  <Menu.SubContent
                                    side={c.compactMenus.current ? 'bottom' : 'right'}
                                    align={'end'}
                                    collisionPadding={8}
                                    className={['library-menu w-56'].filter(Boolean).join(' ')}
                                  >
                                    {c.libraryMenu.finishedOrder ? (
                                      <>
                                        <Menu.Label>{'Finished date'}</Menu.Label>
                                        <Menu.RadioGroup
                                          value={c.libraryMenu.finishedOrder}
                                          onValueChange={c.libraryMenu.setFinishedOrder}
                                        >
                                          <Menu.RadioItem value={'desc'}>
                                            {'Newest first'}
                                          </Menu.RadioItem>
                                          <Menu.RadioItem value={'asc'}>
                                            {'Oldest first'}
                                          </Menu.RadioItem>
                                        </Menu.RadioGroup>
                                      </>
                                    ) : (
                                      <>
                                        <Menu.RadioGroup
                                          value={c.libraryMenu.sortProperty}
                                          onValueChange={(value: any) =>
                                            c.libraryMenu?.setSort(value)
                                          }
                                        >
                                          {c.libraryMenu.sortChoices.map((choice, __index) => (
                                            <Fragment key={choice.property}>
                                              <Menu.RadioItem value={choice.property}>
                                                {choice.label}
                                              </Menu.RadioItem>
                                            </Fragment>
                                          ))}
                                        </Menu.RadioGroup>
                                        <Menu.Sub>
                                          <Menu.SubTrigger>{'More Sort Options'}</Menu.SubTrigger>
                                          <Menu.SubContent
                                            side={c.compactMenus.current ? 'bottom' : 'right'}
                                            align={'end'}
                                            collisionPadding={8}
                                            className={['library-menu w-52']
                                              .filter(Boolean)
                                              .join(' ')}
                                          >
                                            <Menu.RadioGroup
                                              value={c.libraryMenu.sortProperty}
                                              onValueChange={(value: any) =>
                                                c.libraryMenu?.setSort(value)
                                              }
                                            >
                                              {c.libraryMenu.moreSortChoices.map(
                                                (choice, __index) => (
                                                  <Fragment key={choice.property}>
                                                    <Menu.RadioItem value={choice.property}>
                                                      {choice.label}
                                                    </Menu.RadioItem>
                                                  </Fragment>
                                                )
                                              )}
                                            </Menu.RadioGroup>
                                          </Menu.SubContent>
                                        </Menu.Sub>
                                        <Menu.Separator />
                                        <Menu.RadioGroup
                                          value={c.libraryMenu.sortDirection}
                                          onValueChange={(value: any) =>
                                            c.libraryMenu?.setSort(
                                              c.libraryMenu.sortProperty,
                                              value === 'asc' ? 'asc' : 'desc'
                                            )
                                          }
                                        >
                                          <Menu.RadioItem value={'asc'}>
                                            {'Ascending'}
                                          </Menu.RadioItem>
                                          <Menu.RadioItem value={'desc'}>
                                            {'Descending'}
                                          </Menu.RadioItem>
                                        </Menu.RadioGroup>
                                      </>
                                    )}
                                  </Menu.SubContent>
                                </Menu.Sub>
                              </Menu.SubContent>
                            </Menu.Sub>
                            <Menu.Sub>
                              <Menu.SubTrigger>
                                <FolderOpen aria-hidden={'true'} />
                                {'Organize Library'}
                              </Menu.SubTrigger>
                              <Menu.SubContent
                                side={c.compactMenus.current ? 'bottom' : 'right'}
                                align={'end'}
                                collisionPadding={8}
                                className={['library-menu w-64'].filter(Boolean).join(' ')}
                              >
                                <Menu.Item onSelect={c.libraryMenu.createSeries}>
                                  <FolderPlus aria-hidden={'true'} />
                                  {'Create Series from Books…'}
                                </Menu.Item>
                                <Menu.Item onSelect={c.libraryMenu.refreshFolders}>
                                  <Cloud aria-hidden={'true'} />
                                  {'Refresh Connected Folders'}
                                </Menu.Item>
                              </Menu.SubContent>
                            </Menu.Sub>
                          </>
                        ) : null}
                        <Menu.Separator />
                        <Menu.Label>{'Manabi Reader'}</Menu.Label>
                        <Menu.Item onSelect={openUserGuide}>{'User guide'}</Menu.Item>
                        <Menu.Item onSelect={() => goto(resolve('/connections'))}>
                          <UserCircle aria-hidden={'true'} />
                          {'Accounts and Libraries'}
                        </Menu.Item>
                        <Menu.Item onSelect={() => goto(resolve('/statistics'))}>
                          <ChartBar aria-hidden={'true'} />
                          {'Statistics'}
                        </Menu.Item>
                        <Menu.Item onSelect={() => goto(resolve('/settings'))}>
                          <Gear aria-hidden={'true'} />
                          {'Settings'}
                        </Menu.Item>
                        <Menu.Item onSelect={() => goto(resolve('/shared-library'))}>
                          {'Shared Libraries'}
                        </Menu.Item>
                        {c.sources.length > 1 ? (
                          <>
                            <Menu.Separator />
                            <Menu.Sub>
                              <Menu.SubTrigger>{'Storage View'}</Menu.SubTrigger>
                              <Menu.SubContent
                                side={c.compactMenus.current ? 'bottom' : 'right'}
                                align={'end'}
                                collisionPadding={8}
                                className={['library-menu w-64'].filter(Boolean).join(' ')}
                              >
                                <Menu.Label>{'Legacy storage views'}</Menu.Label>
                                <Menu.RadioGroup
                                  value={readStore(storageSource$)}
                                  onValueChange={(value: any) =>
                                    c.sourceChanged(value as StorageKey)
                                  }
                                >
                                  {c.sources.map((source, __index) => (
                                    <Fragment key={source.key}>
                                      <Menu.RadioItem
                                        value={source.key}
                                        disabled={source.online && !readStore(isOnline$)}
                                      >
                                        {source.label}
                                      </Menu.RadioItem>
                                    </Fragment>
                                  ))}
                                </Menu.RadioGroup>
                              </Menu.SubContent>
                            </Menu.Sub>
                          </>
                        ) : null}
                        <Menu.Separator />
                        <Menu.Item onSelect={() => c.dispatch('bugReportClick')}>
                          <Bug aria-hidden={'true'} />
                          {'Report an Issue'}
                        </Menu.Item>
                        {c.isOldUrl ? (
                          <>
                            <Menu.Item onSelect={() => c.dispatch('domainHintClick')}>
                              {'Old Domain Information'}
                            </Menu.Item>
                          </>
                        ) : null}
                        {c.showLoadCount ? (
                          <>
                            <Menu.Item onSelect={() => c.countImportElm?.click()}>
                              {'Import Character Counts'}
                              {readStore(fileCountData$) ? ' (Loaded)' : ''}
                            </Menu.Item>
                          </>
                        ) : null}
                      </Menu.Content>
                    </Menu.Root>
                    {!c.compactLibrary ? (
                      <>
                        <label
                          className={[
                            'hidden min-h-11 w-[clamp(12rem,20vw,18rem)] min-w-0 items-center gap-2 rounded-full bg-muted px-3 text-sm focus-within:ring-2 focus-within:ring-ring lg:flex'
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <Search
                            aria-hidden={'true'}
                            className={['size-5 shrink-0 text-muted-foreground']
                              .filter(Boolean)
                              .join(' ')}
                          />
                          <span className={['sr-only'].filter(Boolean).join(' ')}>
                            {'Search library'}
                          </span>
                          <input
                            type={'search'}
                            disabled={!c.hydrated || !c.libraryMenu}
                            placeholder={'Search dictionary and library'}
                            onInput={c.searchInputChanged}
                            onCompositionStart={c.searchCompositionStarted}
                            onCompositionEnd={c.searchCompositionEnded}
                            onBlur={c.searchInputBlurred}
                            value={c.searchDraft}
                            onChange={(event: any) => {
                              c.searchDraft = event.currentTarget.value;
                            }}
                            className={[
                              'w-full min-w-0 border-0 bg-transparent p-0 shadow-none outline-none focus:border-transparent focus:shadow-none focus:ring-0'
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </div>
            {c.replicationToProgress ? (
              <>
                <div
                  className={[
                    'mx-auto flex min-h-14 max-w-6xl items-center gap-2 px-4 pb-3 sm:px-6'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Button
                    variant={'outline'}
                    onClick={() => c.dispatch('cancelReplication')}
                    title={c.cancelTooltip}
                  >
                    {'Cancel Operation'}
                  </Button>
                  <progress
                    aria-label={'Export progress'}
                    value={c.replicationProgress}
                    max={c.replicationToProgress}
                    className={['h-2 min-w-20 flex-1'].filter(Boolean).join(' ')}
                  />
                  <span
                    role={'status'}
                    className={['text-sm whitespace-nowrap'].filter(Boolean).join(' ')}
                  >
                    {c.replicationProgressRemaining}
                  </span>
                </div>
              </>
            ) : (
              <>
                {c.selectMode ? (
                  <>
                    <div
                      role={'toolbar'}
                      aria-label={'Book selection'}
                      onKeyDown={c.selectionKeydown}
                      className={[
                        c.compactLibrary ? 'compact-selection' : '',
                        'library-selection-toolbar mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-2 border-t border-border/60 px-[16px] py-[8px] sm:px-[24px]'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <Button
                        variant={'ghost'}
                        aria-label={'Cancel selection'}
                        disabled={c.libraryMenu?.selectedActions?.busy}
                        onClick={() => void c.exitSelectionMode()}
                        className={['selection-action'].filter(Boolean).join(' ')}
                      >
                        {c.compactLibrary ? (
                          <>
                            <X
                              aria-hidden={'true'}
                              className={['size-[24px]'].filter(Boolean).join(' ')}
                            />
                          </>
                        ) : (
                          <>{'Cancel selection'}</>
                        )}
                      </Button>
                      <span
                        role={'status'}
                        aria-live={'polite'}
                        aria-atomic={'true'}
                        className={['text-sm whitespace-nowrap'].filter(Boolean).join(' ')}
                      >
                        {c.selectedCount}
                        {' selected'}
                      </span>
                      <Button
                        variant={'outline'}
                        aria-label={c.modernLibrary ? 'Select All Visible' : 'Select all'}
                        disabled={c.libraryMenu?.selectedActions?.busy}
                        onClick={() => c.dispatch('selectAllClick')}
                        className={['selection-action'].filter(Boolean).join(' ')}
                      >
                        {c.compactLibrary ? (
                          <>
                            <SelectionAll
                              aria-hidden={'true'}
                              className={['size-[24px]'].filter(Boolean).join(' ')}
                            />
                          </>
                        ) : (
                          <>{c.modernLibrary ? 'Select All Visible' : 'Select all'}</>
                        )}
                      </Button>
                      {c.selectedCount > 0 ? (
                        <>
                          <Button
                            variant={'secondary'}
                            disabled={
                              c.libraryMenu?.selectedActions?.busy ||
                              c.libraryMenu?.selectedActions?.savedCount === 0
                            }
                            aria-label={'Export'}
                            onClick={() => c.dispatch('replicateData')}
                            className={['selection-action'].filter(Boolean).join(' ')}
                          >
                            {c.compactLibrary ? (
                              <>
                                <FileArrowUp
                                  aria-hidden={'true'}
                                  className={['size-[24px]'].filter(Boolean).join(' ')}
                                />
                              </>
                            ) : (
                              <>{'Export'}</>
                            )}
                          </Button>
                          <ActionMenu
                            label={'Actions'}
                            title={'Selected book actions'}
                            iconOnly={c.compactLibrary}
                          >
                            {c.libraryMenu?.selectedActions ? (
                              <>
                                <Menu.Item
                                  disabled={c.libraryMenu.selectedActions.busy}
                                  onSelect={c.libraryMenu.selectedActions.collections}
                                >
                                  {'Add to Collection…'}
                                </Menu.Item>
                                <Menu.Item
                                  disabled={c.libraryMenu.selectedActions.busy}
                                  onSelect={c.libraryMenu.selectedActions.series}
                                >
                                  {'Add to Series…'}
                                </Menu.Item>
                                {c.libraryMenu.selectedActions.canBlur ? (
                                  <>
                                    <Menu.Item
                                      disabled={c.libraryMenu.selectedActions.busy}
                                      onSelect={c.libraryMenu.selectedActions.blur}
                                    >
                                      {'Blur Covers'}
                                    </Menu.Item>
                                  </>
                                ) : null}
                                {c.libraryMenu.selectedActions.canUnblur ? (
                                  <>
                                    <Menu.Item
                                      disabled={c.libraryMenu.selectedActions.busy}
                                      onSelect={c.libraryMenu.selectedActions.unblur}
                                    >
                                      {'Unblur Covers'}
                                    </Menu.Item>
                                  </>
                                ) : null}
                                <Menu.Separator />
                              </>
                            ) : null}
                            {c.libraryMenu?.selectedWantToRead.canAdd ? (
                              <>
                                <Menu.Item
                                  disabled={c.libraryMenu?.selectedActions?.busy}
                                  onSelect={() => c.libraryMenu?.selectedWantToRead.set(true)}
                                >
                                  <BookmarkSimple aria-hidden={'true'} />
                                  {'Add to Want to Read'}
                                </Menu.Item>
                              </>
                            ) : null}
                            {c.libraryMenu?.selectedWantToRead.canRemove ? (
                              <>
                                <Menu.Item
                                  disabled={c.libraryMenu?.selectedActions?.busy}
                                  onSelect={() => c.libraryMenu?.selectedWantToRead.set(false)}
                                >
                                  <BookmarkSimple weight={'fill'} aria-hidden={'true'} />
                                  {'Remove from Want to Read'}
                                </Menu.Item>
                              </>
                            ) : null}
                            <Menu.Separator />
                            <Menu.Item
                              disabled={
                                c.libraryMenu?.selectedActions?.busy ||
                                c.libraryMenu?.selectedActions?.savedCount === 0
                              }
                              onSelect={() => c.dispatch('selectionToStatistics')}
                            >
                              {'Statistics for Selected Books'}
                            </Menu.Item>
                            <Menu.Item
                              variant={'destructive'}
                              disabled={
                                c.libraryMenu?.selectedActions?.busy ||
                                c.libraryMenu?.selectedActions?.savedCount === 0
                              }
                              onSelect={() => c.dispatch('deleteStatistics')}
                            >
                              {'Delete Selected Statistics'}
                            </Menu.Item>
                            <Menu.Separator />
                            <Menu.Item
                              variant={'destructive'}
                              disabled={
                                c.libraryMenu?.selectedActions?.busy ||
                                c.libraryMenu?.selectedActions?.savedCount === 0
                              }
                              onSelect={() => c.dispatch('removeClick')}
                            >
                              {'Delete Selected Books'}
                            </Menu.Item>
                          </ActionMenu>
                        </>
                      ) : null}
                      {c.selectedCount >
                      (c.libraryMenu?.selectedActions?.savedCount ?? c.selectedCount) ? (
                        <>
                          <p
                            className={['basis-full text-sm text-muted-foreground']
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {
                              ' Unopened previews can be organized without importing. Export, statistics and deletion apply only to saved browser copies. '
                            }
                          </p>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </>
            )}
          </header>
        </>
      ) : (
        <>
          <header
            aria-label={'Library toolbar'}
            className={['app-header border-b border-border bg-card text-foreground']
              .filter(Boolean)
              .join(' ')}
          >
            <div
              className={[
                'mx-auto flex h-12 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6'
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={['flex min-w-0 items-center gap-3'].filter(Boolean).join(' ')}>
                <h1
                  className={['truncate font-serif text-3xl font-bold tracking-tight']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {'Library'}
                </h1>
                <span
                  className={['hidden text-sm text-muted-foreground sm:inline']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {'Manabi Reader'}
                </span>
              </div>
              <div className={['flex items-center gap-1'].filter(Boolean).join(' ')}>
                {c.hasBookOpened && !c.replicationToProgress ? (
                  <>
                    <Button
                      variant={'ghost'}
                      onClick={() => c.dispatch('backToBookClick')}
                      title={'Back to Book'}
                    >
                      {'Resume reading'}
                    </Button>
                  </>
                ) : null}
                {!c.replicationToProgress ? (
                  <>
                    <AppNav />
                  </>
                ) : null}
              </div>
            </div>
            <div
              className={[
                'mx-auto flex min-h-14 max-w-7xl items-center gap-2 overflow-x-auto px-3 pb-2 sm:px-6'
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {c.replicationToProgress ? (
                <>
                  <Button
                    variant={'outline'}
                    onClick={() => c.dispatch('cancelReplication')}
                    title={c.cancelTooltip}
                  >
                    {'Cancel operation'}
                  </Button>
                  <progress
                    aria-label={'Export progress'}
                    value={c.replicationProgress}
                    max={c.replicationToProgress}
                    className={['h-2 min-w-20 flex-1'].filter(Boolean).join(' ')}
                  />
                  <span
                    role={'status'}
                    className={['text-sm whitespace-nowrap'].filter(Boolean).join(' ')}
                  >
                    {c.replicationProgressRemaining}
                  </span>
                </>
              ) : (
                <>
                  {c.selectMode ? (
                    <>
                      <div
                        role={'toolbar'}
                        aria-label={'Book selection'}
                        onKeyDown={c.selectionKeydown}
                        className={['flex min-w-max items-center gap-2'].filter(Boolean).join(' ')}
                      >
                        <Button
                          variant={'ghost'}
                          disabled={c.libraryMenu?.selectedActions?.busy}
                          onClick={() => void c.exitSelectionMode()}
                        >
                          {'Cancel selection'}
                        </Button>
                        <span
                          role={'status'}
                          aria-live={'polite'}
                          aria-atomic={'true'}
                          className={['text-sm whitespace-nowrap'].filter(Boolean).join(' ')}
                        >
                          {c.selectedCount}
                          {' selected'}
                        </span>
                        <Button
                          variant={'outline'}
                          disabled={c.libraryMenu?.selectedActions?.busy}
                          onClick={() => c.dispatch('selectAllClick')}
                        >
                          {'Select all'}
                        </Button>
                        {c.selectedCount > 0 ? (
                          <>
                            <Button
                              variant={'secondary'}
                              onClick={() => c.dispatch('replicateData')}
                              title={'Open Export Menu'}
                            >
                              {'Export'}
                            </Button>
                            <ActionMenu label={'Actions'} title={'Selected book actions'}>
                              {readStore(storageSource$) === StorageKey.BROWSER ? (
                                <>
                                  <Menu.Item
                                    disabled={c.libraryMenu?.selectedActions?.busy}
                                    onSelect={() => c.dispatch('selectionToStatistics')}
                                  >
                                    {'Statistics for selected books'}
                                  </Menu.Item>
                                  <Menu.Item
                                    variant={'destructive'}
                                    disabled={c.libraryMenu?.selectedActions?.busy}
                                    onSelect={() => c.dispatch('deleteStatistics')}
                                  >
                                    {'Delete selected statistics'}
                                  </Menu.Item>
                                  <Menu.Separator />
                                </>
                              ) : null}
                              <Menu.Item
                                variant={'destructive'}
                                disabled={
                                  c.libraryMenu?.selectedActions?.busy ||
                                  c.libraryMenu?.selectedActions?.savedCount === 0
                                }
                                onSelect={() => c.dispatch('removeClick')}
                              >
                                {'Delete selected books'}
                              </Menu.Item>
                            </ActionMenu>
                          </>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <ActionMenu label={'Add books'}>
                        <Menu.Item onSelect={() => c.fileImportElm?.click()}>
                          {'Import File(s)'}
                        </Menu.Item>
                        {!readStore(isMobile$) ? (
                          <>
                            <Menu.Item onSelect={() => c.folderImportElm?.click()}>
                              {'Import Folder(s)'}
                            </Menu.Item>
                          </>
                        ) : null}
                        <Menu.Item onSelect={() => c.backupImportElm?.click()}>
                          {'Import Backup'}
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.Item onSelect={() => goto(resolve('/import-ttu'))}>
                          {'Import from Ttu Ebook Reader'}
                        </Menu.Item>
                        <Menu.Item onSelect={() => c.dispatch('editorsPicksClick')}>
                          {"Editor's Picks"}
                        </Menu.Item>
                      </ActionMenu>
                      <ActionMenu
                        label={
                          c.sources.find((source) => source.key === readStore(storageSource$))
                            ?.label ?? 'Storage'
                        }
                        title={'Select Storage Source'}
                      >
                        <Menu.Label>{'Storage source'}</Menu.Label>
                        <Menu.RadioGroup
                          value={readStore(storageSource$)}
                          onValueChange={(value: any) => c.sourceChanged(value as StorageKey)}
                        >
                          {c.sources.map((source, __index) => (
                            <Fragment key={source.key}>
                              <Menu.RadioItem
                                value={source.key}
                                disabled={source.online && !readStore(isOnline$)}
                              >
                                {source.label}
                              </Menu.RadioItem>
                            </Fragment>
                          ))}
                        </Menu.RadioGroup>
                      </ActionMenu>
                      {!c.modernLibrary ? (
                        <>
                          <ActionMenu label={'Sort'} title={'Select Sort Options'}>
                            <Menu.Label>{'Sort books'}</Menu.Label>
                            <Menu.RadioGroup
                              value={
                                readStore(booklistSortOptions$)[readStore(storageSource$)].property
                              }
                              onValueChange={(property: string) =>
                                c.setSort(
                                  property,
                                  readStore(booklistSortOptions$)[readStore(storageSource$)]
                                    .direction
                                )
                              }
                            >
                              {c.sortItems.map((item, __index) => (
                                <Fragment key={item.property}>
                                  <Menu.RadioItem value={item.property}>
                                    {item.label}
                                  </Menu.RadioItem>
                                </Fragment>
                              ))}
                            </Menu.RadioGroup>
                            <Menu.Separator />
                            <Menu.RadioGroup
                              value={String(
                                readStore(booklistSortOptions$)[readStore(storageSource$)].direction
                              )}
                              onValueChange={(direction: string) =>
                                c.setSort(
                                  readStore(booklistSortOptions$)[readStore(storageSource$)]
                                    .property,
                                  direction as SortDirection
                                )
                              }
                            >
                              <Menu.RadioItem value={String(SortDirection.ASC)}>
                                {'Ascending'}
                              </Menu.RadioItem>
                              <Menu.RadioItem value={String(SortDirection.DESC)}>
                                {'Descending'}
                              </Menu.RadioItem>
                            </Menu.RadioGroup>
                          </ActionMenu>
                        </>
                      ) : null}
                      <Button
                        variant={'ghost'}
                        disabled={!c.hasBooks}
                        onClick={c.enterSelectionMode}
                      >
                        {'Select books'}
                      </Button>
                      <ActionMenu label={'Help'}>
                        <Menu.Item onSelect={() => c.dispatch('bugReportClick')}>
                          {'Report an Issue'}
                        </Menu.Item>
                        {c.isOldUrl ? (
                          <>
                            <Menu.Item onSelect={() => c.dispatch('domainHintClick')}>
                              {'Old domain information'}
                            </Menu.Item>
                          </>
                        ) : null}
                        {c.showLoadCount ? (
                          <>
                            <Menu.Item onSelect={() => c.countImportElm?.click()}>
                              {'Import character counts'}
                              {readStore(fileCountData$) ? ' (loaded)' : ''}
                            </Menu.Item>
                          </>
                        ) : null}
                      </ActionMenu>
                    </>
                  )}
                </>
              )}
            </div>
          </header>
        </>
      )}
    </>
  );
}
