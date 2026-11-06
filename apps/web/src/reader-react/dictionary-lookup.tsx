/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActionButton } from '../shared-ui/ActionButton';
import { Dialog } from '../shared-ui/ModalSurface';
import { TextEntry } from '../shared-ui/TextEntry';
import { UiText } from '../shared-ui/Typography';
import { DictionarySearch } from '../library-react/dictionary';
import {
  readerDictionarySelection,
  openReaderDictionaryLookup,
  closeReaderDictionaryLookup,
  dismissReaderDictionaryLookup
} from '../lib/search/reader-dictionary-interaction';

function LookupContent({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <div className="grid min-w-0 gap-4">
      <TextEntry label="Look up a word" value={query} onChangeText={setQuery} maxLength={256} />
      <DictionarySearch query={query} full hideHeading expand={() => {}} onquery={setQuery} />
    </div>
  );
}

/** Shared controls and the same local dictionary workflow used by Library.
 * The host's chapter lease owns dismissal, including a navigation during lookup. */
export function ReaderDictionaryLookup() {
  const trigger = useRef<HTMLElement | null>(null);
  const selection = useSyncExternalStore(
    readerDictionarySelection.subscribe,
    readerDictionarySelection.getSnapshot,
    () => null
  );
  useEffect(() => () => closeReaderDictionaryLookup(), []);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const changed = () => setViewport({ width: innerWidth, height: innerHeight });
    changed();
    window.addEventListener('resize', changed);
    return () => window.removeEventListener('resize', changed);
  }, []);
  if (!selection) return null;
  const box = selection.box;
  return (
    <>
      {box && (
        <div
          data-ui-overlay="selection"
          className="fixed z-40 writing-horizontal-tb"
          style={{
            left: Math.max(8, Math.min(viewport.width - 160, box.left)),
            top: Math.max(8, Math.min(viewport.height - 52, box.bottom + 6))
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <ActionButton
            ref={(node) => {
              trigger.current = node as unknown as HTMLElement | null;
            }}
            onPress={() => {
              trigger.current?.focus({ preventScroll: true });
              openReaderDictionaryLookup();
            }}
            accessibilityLabel="Look up selected text"
            shape="rounded"
          >
            Look up
          </ActionButton>
        </div>
      )}
      <Dialog
        visible={selection.open}
        onClose={dismissReaderDictionaryLookup}
        title="Dictionary"
        closeLabel="Close dictionary"
        maxWidth={720}
        stickyChrome
        testID="reader-dictionary-lookup"
      >
        <UiText style={{ marginBottom: 16 }}>
          Search your installed dictionaries, including offline.
        </UiText>
        <LookupContent key={selection.query} initialQuery={selection.query} />
      </Dialog>
    </>
  );
}
