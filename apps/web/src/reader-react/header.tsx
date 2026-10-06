/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import {
  Dom,
  ReaderScope,
  Icon,
  Button,
  Menu,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createHeader, type HeaderProps } from './header-controller';
import { openUserGuide } from '$lib/components/navigation/docs-link';
import { ViewMode } from '$lib/data/view-mode';

export function BookReaderHeader(props: Partial<HeaderProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createHeader(props as HeaderProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-header">
      <Dom
        as="header"
        aria-label={'Reader toolbar'}
        className={[
          'app-header reader-toolbar flex min-h-16 items-center justify-between gap-0 bg-background px-2 text-foreground sm:gap-3 sm:px-6'
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Dom
          as="div"
          className={['flex shrink-0 items-center gap-0 sm:gap-1'].filter(Boolean).join(' ')}
        >
          <Button
            variant={'ghost'}
            aria-label={'Library'}
            onClick={() => c.dispatch('bookManagerClick')}
            title={'Return to Library'}
            className={['min-h-11 min-w-11 px-2 sm:px-4'].filter(Boolean).join(' ')}
          >
            <Icon
              name="ArrowLeft"
              aria-hidden={'true'}
              className={['size-4'].filter(Boolean).join(' ')}
            ></Icon>
            <Dom as="span" className={['hidden sm:inline'].filter(Boolean).join(' ')}>
              {'Library'}
            </Dom>
          </Button>
          {c.hasChapterData ? (
            <>
              <Button
                variant={'ghost'}
                onClick={() => c.dispatch('tocClick')}
                title={'Open Table of Contents'}
                aria-label={'Contents'}
                size={'icon'}
                className={['min-h-11 min-w-11 sm:w-auto sm:px-3'].filter(Boolean).join(' ')}
              >
                <Icon
                  name="List"
                  aria-hidden={'true'}
                  className={['size-5'].filter(Boolean).join(' ')}
                ></Icon>
                <Dom as="span" className={['hidden sm:inline'].filter(Boolean).join(' ')}>
                  {'Contents'}
                </Dom>
              </Button>
            </>
          ) : null}
          <Button
            variant={'ghost'}
            onClick={() => c.dispatch('annotationsClick')}
            title={'Bookmarks and Notes'}
            aria-label={'Bookmarks and Notes'}
            size={'icon'}
            className={['min-h-11 min-w-11 sm:w-auto sm:px-3'].filter(Boolean).join(' ')}
          >
            <Icon
              name="Bookmark"
              aria-hidden={'true'}
              className={['size-5'].filter(Boolean).join(' ')}
            ></Icon>
            <Dom as="span" className={['hidden sm:inline'].filter(Boolean).join(' ')}>
              {'Notes'}
            </Dom>
          </Button>
        </Dom>
        <Dom
          as="p"
          title={c.bookTitle}
          className={[
            'hidden min-w-0 flex-1 truncate text-center text-sm text-muted-foreground lg:block'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {c.bookTitle}
        </Dom>
        <Dom
          as="div"
          className={['flex shrink-0 items-center gap-0 sm:gap-1'].filter(Boolean).join(' ')}
        >
          <Button
            variant={'ghost'}
            size={'icon'}
            aria-label={'Themes & Settings'}
            onClick={() => c.dispatch('appearanceClick')}
            className={['min-h-11 min-w-11 md:w-auto md:px-3'].filter(Boolean).join(' ')}
          >
            <Icon
              name="TextAa"
              aria-hidden={'true'}
              className={['size-5'].filter(Boolean).join(' ')}
            ></Icon>
            <Dom as="span" className={['hidden md:inline'].filter(Boolean).join(' ')}>
              {'Appearance'}
            </Dom>
          </Button>
          {c.showFullscreenButton ? (
            <>
              <Button
                variant={'ghost'}
                size={'icon'}
                aria-label={c.fullscreenActive ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                title={c.fullscreenActive ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                disabled={c.fullscreenBusy}
                onClick={() => c.dispatch('fullscreenClick')}
                className={['min-h-11 min-w-11'].filter(Boolean).join(' ')}
              >
                {c.fullscreenActive ? (
                  <>
                    <Icon
                      name="ArrowsIn"
                      aria-hidden={'true'}
                      className={['size-5'].filter(Boolean).join(' ')}
                    ></Icon>
                  </>
                ) : (
                  <>
                    {' '}
                    <Icon
                      name="ArrowsOut"
                      aria-hidden={'true'}
                      className={['size-5'].filter(Boolean).join(' ')}
                    ></Icon>
                  </>
                )}
              </Button>
            </>
          ) : null}
          <Menu.Root
            open={c.toolsOpen}
            bindings={{
              open: (value) => {
                c.toolsOpen = value;
              }
            }}
          >
            <Menu.Trigger
              child={({ props }) => (
                <>
                  <Button
                    {...props}
                    variant={'secondary'}
                    size={'icon'}
                    aria-label={'Reading tools'}
                    title={'Reading tools'}
                    className={['min-h-11 min-w-11 rounded-full'].filter(Boolean).join(' ')}
                  >
                    <Icon
                      name="DotsThree"
                      aria-hidden={'true'}
                      className={['size-5'].filter(Boolean).join(' ')}
                    ></Icon>
                  </Button>
                </>
              )}
            ></Menu.Trigger>
            <Menu.Content
              align={'end'}
              className={['max-h-[min(75dvh,36rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto']
                .filter(Boolean)
                .join(' ')}
            >
              <Menu.Label>{'Reading'}</Menu.Label>
              <Menu.Item onSelect={() => void c.selectTool(() => c.dispatch('bookmarkClick'))}>
                <Icon name="Bookmark" aria-hidden={'true'}></Icon>
                {'Save Reading Position'}
              </Menu.Item>
              {c.hasBookmarkData ? (
                <>
                  <Menu.Item
                    onSelect={() => void c.selectTool(() => c.dispatch('scrollToBookmarkClick'))}
                  >
                    <Icon name="ArrowUUpLeft" aria-hidden={'true'}></Icon>
                    {'Return to Reading Position'}
                  </Menu.Item>
                </>
              ) : null}
              {c.hasText ? (
                <>
                  <Menu.Item onSelect={() => void c.selectTool(() => c.dispatch('jumpClick'))}>
                    <Icon name="Crosshair" aria-hidden={'true'}></Icon>
                    {'Jump to Position'}
                  </Menu.Item>
                </>
              ) : null}
              <Menu.Item onSelect={() => void c.selectTool(() => c.dispatch('scrubClick'))}>
                <Icon name="ArrowsLeftRight" aria-hidden={'true'}></Icon>
                {'Browse Book'}
              </Menu.Item>
              {c.hasText ? (
                <>
                  <Menu.Item
                    onSelect={() => void c.selectTool(() => c.dispatch('searchBookClick'))}
                  >
                    <Icon name="MagnifyingGlass" aria-hidden={'true'}></Icon>
                    {'Search Book'}
                  </Menu.Item>
                </>
              ) : null}
              <Menu.Item onSelect={() => void c.selectTool(() => c.dispatch('lineGuideClick'))}>
                <Icon name="TextAlignJustify" aria-hidden={'true'}></Icon>
                {'Line Guide'}
              </Menu.Item>
              {c.$readerImageGalleryPictures$.length ? (
                <>
                  <Menu.Item
                    onSelect={() => void c.selectTool(() => c.dispatch('readerImageGalleryClick'))}
                  >
                    <Icon name="Images" aria-hidden={'true'}></Icon>
                    {'Image Gallery'}
                  </Menu.Item>
                </>
              ) : null}
              <Menu.Item onSelect={() => void c.selectTool(() => c.dispatch('completeBook'))}>
                <Icon name="CheckCircle" aria-hidden={'true'}></Icon>
                {'Complete Book'}
              </Menu.Item>
              {c.$customReadingPointEnabled$ || c.$viewMode$ === ViewMode.Paginated ? (
                <>
                  <Menu.Separator></Menu.Separator>
                  <Menu.Label>{'Custom reading point'}</Menu.Label>
                  {c.hasCustomReadingPoint ? (
                    <>
                      <Menu.Item
                        onSelect={() =>
                          void c.selectTool(() => c.dispatch('showCustomReadingPoint'))
                        }
                      >
                        <Icon name="MapPin" aria-hidden={'true'}></Icon>
                        {'Show Point'}
                      </Menu.Item>
                    </>
                  ) : null}
                  <Menu.Item
                    onSelect={() => void c.selectTool(() => c.dispatch('setCustomReadingPoint'))}
                  >
                    <Icon name="MapPin" aria-hidden={'true'}></Icon>
                    {'Set Point'}
                  </Menu.Item>
                  {c.hasCustomReadingPoint ? (
                    <>
                      <Menu.Item
                        onSelect={() =>
                          void c.selectTool(() => c.dispatch('resetCustomReadingPoint'))
                        }
                      >
                        <Icon name="ArrowUUpLeft" aria-hidden={'true'}></Icon>
                        {'Reset Point'}
                      </Menu.Item>
                    </>
                  ) : null}
                </>
              ) : null}
              {c.$viewMode$ === ViewMode.Continuous && !c.$isMobile$ ? (
                <>
                  <Menu.Separator></Menu.Separator>
                  <Menu.Label>
                    {'Autoscroll speed: '}
                    {c.autoScrollMultiplier}
                    {'×'}
                  </Menu.Label>
                </>
              ) : null}
              <Menu.Separator></Menu.Separator>
              <Menu.Item onSelect={() => void c.selectTool(() => c.dispatch('settingsClick'))}>
                <Icon name="Gear" aria-hidden={'true'}></Icon>
                {'Settings'}
              </Menu.Item>
              <Menu.Item
                onSelect={() => void c.selectTool(() => c.dispatch('dictionarySetupClick'))}
              >
                <Icon name="BookOpen" aria-hidden={'true'}></Icon>
                {'Dictionary Setup'}
              </Menu.Item>
              <Menu.Item onSelect={() => void c.selectTool(() => c.dispatch('statisticsClick'))}>
                <Icon name="ChartBar" aria-hidden={'true'}></Icon>
                {'Statistics'}
              </Menu.Item>
              <Menu.Item onSelect={openUserGuide}>
                <Icon name="BookOpen" aria-hidden={'true'}></Icon>
                {'User guide'}
              </Menu.Item>
              {c.oldDomain ? (
                <>
                  <Menu.Item
                    onSelect={() => void c.selectTool(() => c.dispatch('domainHintClick'))}
                  >
                    <Icon name="Info" aria-hidden={'true'}></Icon>
                    {'Old domain information'}
                  </Menu.Item>
                </>
              ) : null}
            </Menu.Content>
          </Menu.Root>
        </Dom>
      </Dom>
    </ReaderScope>
  );
}
