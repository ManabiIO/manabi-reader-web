/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import {
  Dom,
  ReaderScope,
  Button,
  Dialog,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createDictionary, type DictionaryProps } from './dictionary-controller';
import { ReaderDictionaryLookup } from './dictionary-lookup';
import { openReaderDictionaryLookup } from '../lib/search/reader-dictionary-interaction';
import {
  PREFERRED_DICTIONARY_EXTENSION_NAME,
  PREFERRED_DEFAULT_INSTALL_BUTTON_ATTRIBUTES
} from '$lib/integrations/external-dictionary-interop';

export function DictionarySetup(props: Partial<DictionaryProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createDictionary(props as DictionaryProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-dictionary">
      <ReaderDictionaryLookup />
      <Dialog.Root
        open={c.open}
        bindings={{
          open: (value) => {
            c.open = value;
          }
        }}
      >
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            if (!c.savedChoice() && !c.extensionAvailable()) c.choose('skip');
            const controls = document.querySelector<HTMLButtonElement>(
              'button[data-reader-controls]'
            );
            if (controls) {
              event.preventDefault();
              controls.focus({ preventScroll: true });
            }
          }}
          className={['writing-horizontal-tb sm:max-w-lg'].filter(Boolean).join(' ')}
        >
          <Dialog.Header>
            <Dialog.Title className={['text-xl'].filter(Boolean).join(' ')}>
              {'Look up words as you read'}
            </Dialog.Title>
            <Dialog.Description
              className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
            >
              {
                'Select text in the book and choose Look up to use your installed dictionaries, including offline. You can also use a browser extension.'
              }
            </Dialog.Description>
          </Dialog.Header>
          <Dom as="div" className={['grid gap-2'].filter(Boolean).join(' ')}>
            <Button
              variant={'secondary'}
              onClick={() => {
                c.choose('done');
                openReaderDictionaryLookup();
              }}
              className={['min-h-11 justify-center'].filter(Boolean).join(' ')}
            >
              {'Open built-in dictionary'}
            </Button>
            {c.bridgeReady ? (
              <>
                <Button
                  {...PREFERRED_DEFAULT_INSTALL_BUTTON_ATTRIBUTES}
                  variant={'secondary'}
                  onClick={() => c.choose('done')}
                  className={['min-h-11 justify-center'].filter(Boolean).join(' ')}
                >
                  {'Install Jitendex'}
                </Button>
              </>
            ) : (
              <>
                {' '}
                <Button
                  href={c.setupUrl}
                  target={'_blank'}
                  rel={'noopener noreferrer'}
                  variant={'secondary'}
                  onClick={() => c.choose('preferred')}
                  className={['min-h-11 justify-center'].filter(Boolean).join(' ')}
                >
                  {`${c.extensionPresent ? 'Update' : 'Get'} ${PREFERRED_DICTIONARY_EXTENSION_NAME}`}
                </Button>
              </>
            )}
            <Button
              variant={'outline'}
              onClick={() => c.choose('other')}
              className={['min-h-11'].filter(Boolean).join(' ')}
            >
              {'Use another extension'}
            </Button>
            <Button
              variant={'ghost'}
              onClick={() => c.choose('skip')}
              className={['min-h-11'].filter(Boolean).join(' ')}
            >
              {'Not now'}
            </Button>
          </Dom>
        </Dialog.Content>
      </Dialog.Root>
    </ReaderScope>
  );
}
