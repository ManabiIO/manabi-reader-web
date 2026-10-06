/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Fragment, type ReactNode } from 'react';
/**
 * React/controller port of lib/search/unified-search.svelte; transactions retain their original guards.
 */

import { videoLearningEnabled } from '$lib/media/feature';

import { librarySearchScopes } from '$lib/search/library-search-scope';

import { SearchController } from './search-controller';

import { DictionarySearch } from './dictionary';
import { BookOpen, FileText, Video } from '@phosphor-icons/react';
export function SearchView({
  c,
  children: _children
}: {
  c: SearchController;
  children?: ReactNode;
}) {
  return (
    <>
      <div
        aria-label={'Library search results'}
        ref={(element: any) => {
          c.results = element;
        }}
        className={['unified-search'].filter(Boolean).join(' ')}
      >
        <div className={['search-controls'].filter(Boolean).join(' ')}>
          <div className={['control-group'].filter(Boolean).join(' ')}>
            <span
              id={'library-search-scope-label'}
              className={['control-label'].filter(Boolean).join(' ')}
            >
              {'Search in'}
            </span>
            <div
              role={'group'}
              aria-labelledby={'library-search-scope-label'}
              className={['scopes'].filter(Boolean).join(' ')}
            >
              {librarySearchScopes.map((item, __index) => (
                <Fragment key={item.id}>
                  <button
                    type={'button'}
                    data-search-scope={item.id}
                    aria-pressed={c.searchScope === item.id}
                    onClick={() => void c.chooseScope(item.id)}
                  >
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
          <div className={['control-group'].filter(Boolean).join(' ')}>
            <span
              id={'library-search-result-type-label'}
              className={['control-label'].filter(Boolean).join(' ')}
            >
              {'Show'}
            </span>
            <div
              role={'group'}
              aria-labelledby={'library-search-result-type-label'}
              className={['filters'].filter(Boolean).join(' ')}
            >
              {c.availableFilters.map((item, __index) => (
                <Fragment key={item.id}>
                  <button
                    type={'button'}
                    data-search-filter={item.id}
                    aria-pressed={c.filter === item.id}
                    onClick={() => void c.choose(item.id)}
                  >
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
        {c.scopePlan.dictionary && (c.filter === 'all' || c.filter === 'dictionary') ? (
          <>
            <DictionarySearch
              query={c.query}
              full={c.filter === 'dictionary'}
              expand={() => void c.choose('dictionary')}
              onquery={c.onquery}
            />
          </>
        ) : null}
        {[...c.query].length > 512 && c.filter !== 'dictionary' ? (
          <>
            <p role={'alert'}>{' Use a search of 512 characters or fewer. '}</p>
          </>
        ) : null}
        {c.filter === 'all' || c.filter === 'titles' ? (
          <>
            <section
              aria-labelledby={'title-search-heading'}
              aria-busy={c.titles.state === 'loading'}
            >
              <header>
                <h2 id={'title-search-heading'}>{'Titles'}</h2>
                {c.filter === 'all' ? (
                  <>
                    <button type={'button'} onClick={() => void c.choose('titles')}>
                      {'See all titles '}
                      <span aria-hidden={'true'}>{'→'}</span>
                    </button>
                  </>
                ) : null}
              </header>
              {c.titles.state === 'loading' ? (
                <>
                  <p role={'status'} className={['note'].filter(Boolean).join(' ')}>
                    {'Searching titles…'}
                  </p>
                </>
              ) : null}
              {c.titles.state === 'error' || c.titles.value?.failed ? (
                <>
                  <p role={'status'} className={['note'].filter(Boolean).join(' ')}>
                    {c.titles.error ??
                      'Some title sources could not be searched. Other title matches remain available.'}
                    <button type={'button'} onClick={c.startTitles}>
                      {'Retry titles'}
                    </button>
                  </p>
                </>
              ) : null}
              <ul aria-label={'Title results'}>
                {c.visibleTitles.map((row, __index) => (
                  <Fragment key={row.id}>
                    <li>
                      <button
                        type={'button'}
                        data-search-row={'titles'}
                        aria-label={row.label}
                        aria-describedby={`search-title-detail-${encodeURIComponent(row.id)}`}
                        onClick={() => c.openRow(row)}
                        className={['result-row'].filter(Boolean).join(' ')}
                      >
                        <span
                          aria-hidden={'true'}
                          className={['type-icon'].filter(Boolean).join(' ')}
                        >
                          {row.kind === 'Book' ? (
                            <>
                              <BookOpen size={20} />
                            </>
                          ) : (
                            <>
                              {row.kind === 'Video' ? (
                                <>
                                  <Video size={20} />
                                </>
                              ) : (
                                <>
                                  <FileText size={20} />
                                </>
                              )}
                            </>
                          )}
                        </span>
                        <span className={['row-copy'].filter(Boolean).join(' ')}>
                          <strong>
                            <SearchExcerpt text={row.title} match={row.titleMatch} />
                          </strong>
                          <small id={`search-title-detail-${encodeURIComponent(row.id)}`}>
                            {row.kind}
                            {row.detail ? (
                              <>
                                {' · '}
                                <SearchExcerpt text={row.detail} match={row.detailMatch} />
                              </>
                            ) : null}
                          </small>
                        </span>
                      </button>
                    </li>
                  </Fragment>
                ))}
              </ul>
              {c.titles.state === 'ready' && !c.visibleTitles.length ? (
                <>
                  <p className={['note'].filter(Boolean).join(' ')}>{' No matching titles. '}</p>
                </>
              ) : null}
              {c.filter === 'titles' && (c.titles.value?.rows.length ?? 0) > c.titleLimit ? (
                <>
                  <button type={'button'} onClick={() => void c.more('titles')}>
                    {'Show more titles'}
                  </button>
                </>
              ) : null}
              {c.titles.value?.truncated ? (
                <>
                  <p className={['note'].filter(Boolean).join(' ')}>
                    {
                      ' Some video titles were omitted. Refine your query for more specific matches. '
                    }
                  </p>
                </>
              ) : null}
            </section>
          </>
        ) : null}
        {c.filter === 'all' || c.filter === 'content' ? (
          <>
            <section
              aria-labelledby={'content-search-heading'}
              aria-busy={c.content.state === 'loading'}
            >
              <header>
                <h2 id={'content-search-heading'}>{'Content'}</h2>
                {c.filter === 'all' ? (
                  <>
                    <button type={'button'} onClick={() => void c.choose('content')}>
                      {'See all content '}
                      <span aria-hidden={'true'}>{'→'}</span>
                    </button>
                  </>
                ) : null}
              </header>
              {c.content.state === 'loading' ? (
                <>
                  <p role={'status'} className={['note'].filter(Boolean).join(' ')}>
                    {' Searching saved content… '}
                  </p>
                </>
              ) : null}
              {c.content.state === 'error' || c.content.value?.failed ? (
                <>
                  <p role={'status'} className={['note'].filter(Boolean).join(' ')}>
                    {c.content.error ??
                      'Some saved content could not be searched. Other matches are still available.'}
                    <button type={'button'} onClick={c.startContent}>
                      {'Retry content'}
                    </button>
                  </p>
                </>
              ) : null}
              <ul aria-label={'Content results'}>
                {c.visibleContent.map((row, __index) => (
                  <Fragment key={row.id}>
                    <li>
                      <button
                        type={'button'}
                        data-search-row={'content'}
                        aria-label={row.label}
                        onClick={() => c.openRow(row)}
                        className={['result-row passage'].filter(Boolean).join(' ')}
                      >
                        <span
                          aria-hidden={'true'}
                          className={['type-icon'].filter(Boolean).join(' ')}
                        >
                          {row.kind === 'Book' ? (
                            <>
                              <BookOpen size={20} />
                            </>
                          ) : (
                            <>
                              {row.kind === 'Video' ? (
                                <>
                                  <Video size={20} />
                                </>
                              ) : (
                                <>
                                  <FileText size={20} />
                                </>
                              )}
                            </>
                          )}
                        </span>
                        <span className={['row-copy'].filter(Boolean).join(' ')}>
                          <span className={['excerpt'].filter(Boolean).join(' ')}>
                            <SearchExcerpt text={row.excerpt ?? ''} match={row.match} />
                          </span>
                          <small>
                            {row.kind}
                            {' · '}
                            {row.title}
                            {row.detail ? ` · ${row.detail}` : ''}
                          </small>
                        </span>
                      </button>
                    </li>
                  </Fragment>
                ))}
              </ul>
              {c.content.state === 'ready' &&
              !c.visibleContent.length &&
              !c.content.value?.failed ? (
                <>
                  <p className={['note'].filter(Boolean).join(' ')}>
                    {' No matches in content saved in this browser. '}
                  </p>
                </>
              ) : null}
              {c.filter === 'content' && (c.content.value?.rows.length ?? 0) > c.contentLimit ? (
                <>
                  <button type={'button'} onClick={() => void c.more('content')}>
                    {'Show more content'}
                  </button>
                </>
              ) : null}
              {c.content.value?.truncated ? (
                <>
                  <p className={['note'].filter(Boolean).join(' ')}>
                    {
                      ' The local search limit was reached. Refine your query for more specific matches. '
                    }
                  </p>
                </>
              ) : null}
              <p className={['note scope-note'].filter(Boolean).join(' ')}>
                {c.searchScope === 'books'
                  ? 'Searches saved books without downloading cloud content.'
                  : c.searchScope === 'snippets'
                    ? 'Searches snippets already indexed in this browser.'
                    : videoLearningEnabled
                      ? 'Searches saved books, snippets and published video transcripts without downloading cloud video bytes or starting transcription.'
                      : 'Searches saved books and snippets without downloading cloud content.'}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
import { useController, useControllerProps } from './use-controller';
type SearchProps = Pick<
  SearchController,
  | 'query'
  | 'searchScope'
  | 'books'
  | 'bookSearchSnapshot'
  | 'returnTo'
  | 'openBook'
  | 'onquery'
  | 'onscope'
> & {
  snippetMembers?: string[];
};
export function UnifiedSearch(props: SearchProps) {
  const c = useController(() => Object.assign(new SearchController(), props));
  useControllerProps(c, props);
  return <SearchView c={c} />;
}
function SearchExcerpt({
  text = '',
  match
}: {
  text?: string;
  match?: {
    start: number;
    end: number;
  };
}) {
  const valid =
    match &&
    Number.isInteger(match.start) &&
    Number.isInteger(match.end) &&
    match.start >= 0 &&
    match.end > match.start &&
    match.end <= text.length;
  return (
    <bdi
      dir="auto"
      data-search-excerpt
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {valid && match ? (
        <>
          {text.slice(0, match.start)}
          <mark>{text.slice(match.start, match.end)}</mark>
          {text.slice(match.end)}
        </>
      ) : (
        text
      )}
    </bdi>
  );
}
