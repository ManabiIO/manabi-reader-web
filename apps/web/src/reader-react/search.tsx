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
import { createSearch, type SearchProps } from './search-controller';
import { SearchExcerpt } from './extras';

export function ReaderSearch(props: Partial<SearchProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createSearch(props as SearchProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-search">
      <Sheet.Root open={c.open} onOpenChange={(value) => (c.open = value)}>
        <Sheet.Content
          side={'left'}
          showCloseButton={false}
          onEscapeKeydown={(event) => {
            // Escape first belongs to the input method's candidate/composition UI.
            // 229 covers engines that omit isComposing on the terminating key.
            if (c.composing || event.isComposing || event.keyCode === 229) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // Search collapses the toolbar, so its menu item no longer exists.
            // Restore the surviving reader control instead of leaving focus on body.
            const controls = document.querySelector<HTMLButtonElement>(
              'button[data-reader-controls]'
            );
            if (controls) {
              event.preventDefault();
              controls.focus();
            }
          }}
          className={[
            'writing-horizontal-tb overflow-hidden p-0 data-[side=left]:w-full data-[side=left]:sm:max-w-md'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Dom as="div" className={['search-toolbar'].filter(Boolean).join(' ')}>
            <Sheet.Title>{'Search Book'}</Sheet.Title>
            <CloseButton aria-label={'Close search'} onClick={() => (c.open = false)}></CloseButton>
          </Dom>
          <Dom
            as="div"
            data-search-scroll={true}
            className={['search-scroll'].filter(Boolean).join(' ')}
          >
            <Sheet.Description>
              {'Find text in '}
              {c.bookTitle || 'this book'}
              {'.'}
            </Sheet.Description>
            <Dom as="div" className={['search-options'].filter(Boolean).join(' ')}>
              <Dom
                as="div"
                className={['search-field', !!c.queryError && 'invalid'].filter(Boolean).join(' ')}
              >
                <Dom
                  as="input"
                  elementRef={(value) => {
                    c.inputElement = value;
                  }}
                  type={'search'}
                  dir={'auto'}
                  autocapitalize={'none'}
                  autoComplete={'off'}
                  spellcheck={false}
                  aria-label={'Search within book'}
                  aria-invalid={c.queryError ? true : undefined}
                  aria-describedby={c.queryError ? 'reader-search-query-error' : undefined}
                  placeholder={'Search this book'}
                  value={c.query}
                  events={{
                    input: (event) => {
                      c.query = event.currentTarget.value;
                      c.schedule();
                    },
                    compositionstart: () => {
                      c.composing = true;
                      c.schedule();
                    },
                    compositionend: (event) => {
                      c.query = event.currentTarget.value;
                      c.composing = false;
                      c.schedule();
                    }
                  }}
                  bindings={{
                    value: (value) => {
                      c.query = value;
                    }
                  }}
                />
                {c.query ? (
                  <>
                    <Dom
                      as="button"
                      type={'button'}
                      aria-label={'Clear search'}
                      className={['clear-search'].filter(Boolean).join(' ')}
                      events={{ click: c.clearSearch }}
                    >
                      <Icon name="XIcon" size={18} weight={'bold'} aria-hidden={'true'}></Icon>
                    </Dom>
                  </>
                ) : null}
              </Dom>
              <Dom
                as="label"
                className={['flex min-h-11 items-center gap-2 text-sm'].filter(Boolean).join(' ')}
              >
                <Dom
                  as="input"
                  type={'checkbox'}
                  checked={c.matchCase}
                  className={['size-4 accent-primary'].filter(Boolean).join(' ')}
                  events={{
                    change: (event) => {
                      c.matchCase = event.currentTarget.checked;
                      c.schedule();
                    }
                  }}
                  bindings={{
                    checked: (value) => {
                      c.matchCase = value;
                    }
                  }}
                />
                {'Match case'}
              </Dom>
            </Dom>
            <Dom
              as="p"
              role={'status'}
              aria-live={'polite'}
              aria-atomic={'true'}
              className={['my-4 shrink-0 text-sm text-muted-foreground'].filter(Boolean).join(' ')}
            >
              {c.queryError ? (
                <>{'Search too long.'}</>
              ) : (
                <>
                  {' '}
                  {c.searchError ? (
                    <>{'Search unavailable.'}</>
                  ) : (
                    <>
                      {' '}
                      {c.composing ? (
                        <>{'Finish entering text to search.'}</>
                      ) : (
                        <>
                          {' '}
                          {c.searching ? (
                            <>{'Searching…'}</>
                          ) : (
                            <>
                              {' '}
                              {c.query.trim() ? (
                                <>
                                  {c.truncated ? 'At least ' : ''}
                                  {c.total}
                                  {c.total === 1 ? 'result' : 'results'}
                                </>
                              ) : (
                                <> {'Enter a word or phrase.'}</>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </Dom>
            {c.queryError ? (
              <>
                <Dom
                  as="p"
                  id={'reader-search-query-error'}
                  role={'alert'}
                  className={['mb-3 text-sm text-destructive'].filter(Boolean).join(' ')}
                >
                  {c.queryError}
                </Dom>
              </>
            ) : (
              <>
                {' '}
                {c.searchError ? (
                  <>
                    <Dom
                      as="div"
                      className={['mb-3 grid shrink-0 gap-2'].filter(Boolean).join(' ')}
                    >
                      <Dom
                        as="p"
                        role={'alert'}
                        className={['text-sm text-destructive'].filter(Boolean).join(' ')}
                      >
                        {c.searchError}
                      </Dom>
                      <Button variant={'secondary'} onClick={c.schedule}>
                        {'Retry Search'}
                      </Button>
                    </Dom>
                  </>
                ) : null}
              </>
            )}
            {c.selectionError ? (
              <>
                <Dom
                  as="p"
                  role={'alert'}
                  className={['mb-3 text-sm text-destructive'].filter(Boolean).join(' ')}
                >
                  {c.selectionError}
                </Dom>
              </>
            ) : null}

            {c.query.trim() &&
            !c.composing &&
            !c.searching &&
            !c.queryError &&
            !c.searchError &&
            !c.hits.length ? (
              <>
                <Dom as="div" className={['empty-search'].filter(Boolean).join(' ')}>
                  <Dom as="p">{'No matches in this book'}</Dom>
                  <Dom as="p">{'Try another spelling or a shorter phrase.'}</Dom>
                </Dom>
              </>
            ) : null}
            <Dom
              as="div"
              elementRef={(value) => {
                c.resultsElement = value;
              }}
              role={'region'}
              aria-label={'Search results'}
              className={['shrink-0'].filter(Boolean).join(' ')}
            >
              {(c.hits.slice(0, c.visibleCount) ?? []).map((hit, index) => (
                <React.Fragment key={`${hit.resource.spineIndex}:${hit.start}:${index}`}>
                  <Dom
                    as="button"
                    type={'button'}
                    data-search-result={true}
                    className={['search-result'].filter(Boolean).join(' ')}
                    events={{
                      focus: (event) => c.revealResult(event.currentTarget),
                      click: () => c.select(hit)
                    }}
                  >
                    <Dom as="span" className={['result-location'].filter(Boolean).join(' ')}>
                      <Dom as="span">
                        {'Section '}
                        {hit.resource.spineIndex + 1}
                      </Dom>
                      <Dom as="span">
                        {'Match '}
                        {index + 1}
                      </Dom>
                    </Dom>
                    <Dom as="span" className={['result-excerpt'].filter(Boolean).join(' ')}>
                      <SearchExcerpt text={hit.excerpt} match={hit.excerptMatch}></SearchExcerpt>
                    </Dom>
                  </Dom>
                </React.Fragment>
              ))}
              {c.hits.length > c.visibleCount || c.revealingResults ? (
                <>
                  <Button
                    variant={'ghost'}
                    onClick={c.showMore}
                    className={['my-2 min-h-11 w-full'].filter(Boolean).join(' ')}
                  >
                    {'Show more results'}
                  </Button>
                </>
              ) : null}
            </Dom>
          </Dom>
        </Sheet.Content>
      </Sheet.Root>
    </ReaderScope>
  );
}
