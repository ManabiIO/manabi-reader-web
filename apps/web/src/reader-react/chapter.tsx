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
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createChapter, type ChapterProps } from './chapter-controller';

export function BookToc(props: Partial<ChapterProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createChapter(props as ChapterProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-chapter">
      <Dom
        as="section"
        aria-label={'Table of contents'}
        className={['contents-panel flex min-h-full shrink-0 flex-col'].filter(Boolean).join(' ')}
      >
        <Dom
          as="header"
          className={['grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-6 pt-6 pb-4']
            .filter(Boolean)
            .join(' ')}
        >
          <Dom as="div" className={['min-w-0'].filter(Boolean).join(' ')}>
            <Dom as="h2" className={['text-xl font-semibold'].filter(Boolean).join(' ')}>
              {'Contents'}
            </Dom>
            <Dom
              as="p"
              className={['mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]']
                .filter(Boolean)
                .join(' ')}
            >
              {c.bookTitle}
            </Dom>
          </Dom>
          <CloseButton
            aria-label={'Close Table of Contents'}
            onClick={c.closeTocMenu}
          ></CloseButton>
        </Dom>
        {c.currentChapter ? (
          <>
            <Dom
              as="div"
              className={['mx-6 mb-3 border-b border-border pb-4'].filter(Boolean).join(' ')}
            >
              <Dom
                as="p"
                className={['text-xs font-medium text-muted-foreground'].filter(Boolean).join(' ')}
              >
                {'Current chapter'}
              </Dom>
              <Dom
                as="p"
                className={['mt-1 font-medium [overflow-wrap:anywhere]'].filter(Boolean).join(' ')}
              >
                {c.currentChapter.label || `Chapter ${c.currentChapterIndex + 1}`}
              </Dom>
              {c.currentChapterProgress !== undefined ? (
                <>
                  <Dom
                    as="div"
                    role={'progressbar'}
                    aria-label={'Chapter progress'}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={c.currentChapterProgress}
                    className={['mt-3 h-1 overflow-hidden rounded-full bg-foreground/10']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Dom
                      as="div"
                      className={['h-full rounded-full bg-foreground/60'].filter(Boolean).join(' ')}
                      style={{ width: `${c.currentChapterProgress}%` }}
                    ></Dom>
                  </Dom>
                </>
              ) : null}
              <Dom
                as="p"
                className={['mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]']
                  .filter(Boolean)
                  .join(' ')}
              >
                {c.currentChapterProgress === undefined
                  ? 'Progress unavailable'
                  : `${Number(c.currentChapterProgress.toFixed(2))}%`}
                {c.characterProgress ? (
                  <>
                    {'· '}
                    {c.characterProgress.read}
                    {' / '}
                    {c.characterProgress.total}
                    {' characters'}
                  </>
                ) : null}
              </Dom>
            </Dom>
          </>
        ) : null}
        <Dom
          as="nav"
          elementRef={(value) => {
            c.chapterList = value;
          }}
          aria-label={'Chapters'}
          className={['flex-1 px-3 pb-4'].filter(Boolean).join(' ')}
        >
          {(c.chapters ?? []).map((chapter, index) => (
            <React.Fragment key={chapter.reference}>
              <Dom
                as="button"
                type={'button'}
                title={`Go to ${chapter.label || `Chapter ${index + 1}`}`}
                aria-current={index === c.currentChapterIndex ? 'location' : undefined}
                className={[
                  'chapter-row flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left'
                ]
                  .filter(Boolean)
                  .join(' ')}
                events={{ click: () => c.goToChapter(index, true) }}
              >
                <Dom
                  as="span"
                  className={['min-w-0 flex-1 [overflow-wrap:anywhere]'].filter(Boolean).join(' ')}
                >
                  {chapter.label || `Chapter ${index + 1}`}
                </Dom>
                {chapter.progress === 100 ? (
                  <>
                    <Icon
                      name="Check"
                      aria-label={'Finished'}
                      className={['size-4 shrink-0 text-muted-foreground']
                        .filter(Boolean)
                        .join(' ')}
                    ></Icon>
                  </>
                ) : (
                  <>
                    {' '}
                    {index === c.currentChapterIndex ? (
                      <>
                        <Dom
                          as="span"
                          aria-hidden={'true'}
                          className={['size-1.5 shrink-0 rounded-full bg-foreground']
                            .filter(Boolean)
                            .join(' ')}
                        ></Dom>
                      </>
                    ) : null}
                  </>
                )}
              </Dom>
            </React.Fragment>
          ))}
        </Dom>
        <Dom
          as="footer"
          className={['flex flex-wrap justify-between gap-2 border-t border-border p-4']
            .filter(Boolean)
            .join(' ')}
        >
          <Button
            variant={'ghost'}
            disabled={c.previousIndex < 0}
            title={`${c.verticalMode ? 'Next' : 'Previous'} Chapter`}
            aria-label={`${c.verticalMode ? 'Next' : 'Previous'} Chapter`}
            onClick={() => c.goToChapter(c.previousIndex)}
            className={['min-h-11'].filter(Boolean).join(' ')}
          >
            <Icon name="CaretLeft" aria-hidden={'true'}></Icon>
            <Dom as="span">
              {c.verticalMode ? 'Next' : 'Previous'}
              <Dom as="span" className={['hidden sm:inline'].filter(Boolean).join(' ')}>
                {' Chapter'}
              </Dom>
            </Dom>
          </Button>
          <Button
            variant={'ghost'}
            disabled={c.nextIndex < 0}
            title={`${c.verticalMode ? 'Previous' : 'Next'} Chapter`}
            aria-label={`${c.verticalMode ? 'Previous' : 'Next'} Chapter`}
            onClick={() => c.goToChapter(c.nextIndex)}
            className={['min-h-11'].filter(Boolean).join(' ')}
          >
            <Dom as="span">
              {c.verticalMode ? 'Previous' : 'Next'}
              <Dom as="span" className={['hidden sm:inline'].filter(Boolean).join(' ')}>
                {' Chapter'}
              </Dom>
            </Dom>
            <Icon name="CaretRight" aria-hidden={'true'}></Icon>
          </Button>
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
