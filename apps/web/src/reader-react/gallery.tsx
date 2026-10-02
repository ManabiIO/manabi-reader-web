/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import {
  Dom,
  SurfaceEvents,
  ReaderScope,
  Icon,
  Button,
  CloseButton,
  Dialog,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createGallery, type GalleryProps } from './gallery-controller';

export function BookReaderImageGallery(props: Partial<GalleryProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createGallery(props as GalleryProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-gallery">
      <SurfaceEvents target="window" events={{ keydown: c.onKeyDown }}></SurfaceEvents>
      <Dialog.Root
        open={true}
        onOpenChange={(open) => {
          if (!open) c.close();
        }}
      >
        <Dialog.Content
          ref={c.gallery}
          showCloseButton={false}
          styleText={
            'inset: 0; width: auto; height: auto; max-width: none; max-height: none; transform: none;'
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
              .querySelector<HTMLButtonElement>('button[data-reader-controls]')
              ?.focus({ preventScroll: true });
          }}
          className={[
            'top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none p-0 writing-horizontal-tb sm:max-w-none'
          ]
            .filter(Boolean)
            .join(' ')}
          bindings={{
            ref: (value) => {
              c.gallery = value;
            }
          }}
        >
          <Dom as="header" className={['gallery-header border-b'].filter(Boolean).join(' ')}>
            <Dom as="div" className={['min-w-0'].filter(Boolean).join(' ')}>
              <Dialog.Title>{'Image gallery'}</Dialog.Title>
              <Dialog.Description>
                {c.$readerImageGalleryPictures$.length}
                {' book images. Select an image to view it.'}
              </Dialog.Description>
            </Dom>
            <CloseButton aria-label={'Close Image Gallery'} onClick={c.close}></CloseButton>
          </Dom>
          <Dom
            as="div"
            className={['gallery-layout', !!c.selectedImage && 'has-selection']
              .filter(Boolean)
              .join(' ')}
          >
            <Dom
              as="div"
              elementRef={(value) => {
                c.contentContainer = value;
              }}
              className={['gallery-list bg-muted/40'].filter(Boolean).join(' ')}
            >
              {(c.$readerImageGalleryPictures$ ?? []).map((picture, index) => (
                <React.Fragment key={picture.url}>
                  {(() => {
                    const hidden = c.$hideSpoilerImage$ && !picture.unspoilered;
                    return (
                      <>
                        <Dom
                          as="button"
                          type={'button'}
                          aria-label={
                            hidden ? `Show hidden image ${index + 1}` : `View image ${index + 1}`
                          }
                          aria-pressed={c.selectedImageIndex === index}
                          data-image-index={index}
                          className={[
                            'gallery-thumbnail rounded-xl border bg-card p-2 text-card-foreground focus-visible:ring-2 focus-visible:ring-ring'
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          events={{
                            click: () => {
                              if (hidden) c.reveal(picture.url);
                              else c.select(index);
                            }
                          }}
                        >
                          <Dom
                            as="div"
                            className={['thumbnail-art', hidden && 'spoiler']
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <Dom
                              as="img"
                              src={picture.url}
                              alt={hidden ? '' : `Book illustration ${index + 1}`}
                            />
                            {hidden ? (
                              <>
                                <Dom
                                  as="span"
                                  className={['spoiler-label'].filter(Boolean).join(' ')}
                                >
                                  {'Show image · ネタバレ'}
                                </Dom>
                              </>
                            ) : null}
                          </Dom>
                          <Dom
                            as="span"
                            className={['mt-2 block text-xs'].filter(Boolean).join(' ')}
                          >
                            {'Image '}
                            {index + 1}
                          </Dom>
                        </Dom>
                      </>
                    );
                  })()}
                </React.Fragment>
              ))}
            </Dom>
            <Dom
              as="div"
              tabIndex={'-1'}
              elementRef={(value) => {
                c.imageContainer = value;
              }}
              className={['gallery-viewer bg-background text-foreground'].filter(Boolean).join(' ')}
              events={{ wheel: c.onWheel }}
            >
              {c.selectedImage ? (
                <>
                  <Dom
                    as="div"
                    className={[
                      'gallery-toolbar flex flex-wrap items-center justify-between gap-2 border-b p-3'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {!c.desktop ? (
                      <>
                        <Button variant={'ghost'} onClick={c.backToImages}>
                          {'All images'}
                        </Button>
                      </>
                    ) : null}
                    <Dom as="div" className={['gallery-navigation'].filter(Boolean).join(' ')}>
                      <Button
                        variant={'secondary'}
                        disabled={c.selectedImageIndex === 0}
                        onClick={c.previousImage}
                      >
                        <Icon name="ChevronLeft"></Icon>
                        {' Previous '}
                      </Button>
                      <Dom
                        as="span"
                        aria-live={'polite'}
                        className={['text-sm tabular-nums'].filter(Boolean).join(' ')}
                      >
                        {c.selectedImageIndex + 1}
                        {' / '}
                        {c.$readerImageGalleryPictures$.length}
                      </Dom>
                      <Button
                        variant={'secondary'}
                        disabled={
                          c.selectedImageIndex === c.$readerImageGalleryPictures$.length - 1
                        }
                        onClick={c.nextImage}
                      >
                        {' Next '}
                        <Icon name="ChevronRight"></Icon>
                      </Button>
                    </Dom>
                  </Dom>
                  <Dom
                    as="div"
                    className={['gallery-art', c.selectedIsHidden && 'spoiler']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Dom
                      as="img"
                      src={c.selectedImage.url}
                      alt={
                        c.selectedIsHidden ? '' : `Book illustration ${c.selectedImageIndex + 1}`
                      }
                    />
                    {c.selectedIsHidden ? (
                      <>
                        <Dom
                          as="button"
                          type={'button'}
                          className={['spoiler-label'].filter(Boolean).join(' ')}
                          events={{ click: c.revealSelected }}
                        >
                          {'Show image · ネタバレ'}
                        </Dom>
                      </>
                    ) : null}
                  </Dom>
                </>
              ) : null}
            </Dom>
          </Dom>
        </Dialog.Content>
      </Dialog.Root>
    </ReaderScope>
  );
}
