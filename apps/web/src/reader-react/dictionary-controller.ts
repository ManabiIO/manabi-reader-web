/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { localStorage } from '$lib/data/window/local-storage';
import {
  DICTIONARY_EXTENSION_MUTATION_ATTRIBUTES,
  PREFERRED_DICTIONARY_EXTENSION_SETUP_URL,
  normalizeDictionarySetupChoice,
  preferredDictionaryExtensionPresent,
  preferredDictionaryReaderBridgeReady,
  type DictionarySetupChoice
} from '$lib/integrations/external-dictionary-interop';

import { ReaderController } from './controller';
export interface DictionaryProps {
  contentReady?: boolean;
}

export function createDictionary(
  props: DictionaryProps,
  _emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let contentReady = props.contentReady !== undefined ? props.contentReady : false;
  const choiceKey = 'manabi-reader-dictionary-setup-v1';
  const setupUrl = PREFERRED_DICTIONARY_EXTENSION_SETUP_URL;
  let open = false;
  let mounted = false;
  let checked = false;
  let extensionPresent = false;
  let bridgeReady = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function show() {
    __readerController.changed((extensionPresent = extensionAvailable()));
    __readerController.changed((bridgeReady = readerBridgeReady()));
    __readerController.changed((open = true));
  }
  function savedChoice() {
    try {
      return normalizeDictionarySetupChoice(localStorage.getItem(choiceKey));
    } catch {
      return null;
    }
  }
  function extensionAvailable() {
    return preferredDictionaryExtensionPresent(document);
  }
  function readerBridgeReady() {
    return preferredDictionaryReaderBridgeReady(document);
  }
  function choose(value: DictionarySetupChoice) {
    try {
      localStorage.setItem(choiceKey, value);
    } catch {
      // Private browsing can deny storage. The current prompt still closes.
    }
    __readerController.changed((open = false));
  }
  __readerController.effect(
    () => [mounted, contentReady],
    () => {
      if (mounted && contentReady && !checked) {
        __readerController.changed((checked = true));
        __readerController.changed(
          (timer = setTimeout(() => {
            __readerController.changed((extensionPresent = extensionAvailable()));
            __readerController.changed((bridgeReady = readerBridgeReady()));
            const choice = savedChoice();
            if ((!choice && !extensionPresent) || (choice === 'preferred' && bridgeReady))
              __readerController.changed((open = true));
          }, 1200))
        );
      }
    }
  );
  __readerController.onMount(() => {
    __readerController.changed((mounted = true));
    const observer = new MutationObserver(() => {
      __readerController.changed((extensionPresent = extensionAvailable()));
      __readerController.changed((bridgeReady = readerBridgeReady()));
      if (contentReady && savedChoice() === 'preferred' && bridgeReady)
        __readerController.changed((open = true));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [...DICTIONARY_EXTENSION_MUTATION_ATTRIBUTES]
    });
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  });

  const api = {
    controller: __readerController,
    show,
    savedChoice,
    extensionAvailable,
    readerBridgeReady,
    choose,
    get contentReady() {
      return contentReady;
    },
    set contentReady(nextValue: typeof contentReady) {
      if (Object.is(contentReady, nextValue)) return;
      contentReady = nextValue;
      __readerController.invalidate();
    },
    get choiceKey() {
      return choiceKey;
    },
    get setupUrl() {
      return setupUrl;
    },
    get open() {
      return open;
    },
    set open(nextValue: typeof open) {
      if (Object.is(open, nextValue)) return;
      open = nextValue;
      __readerController.invalidate();
    },
    get mounted() {
      return mounted;
    },
    set mounted(nextValue: typeof mounted) {
      if (Object.is(mounted, nextValue)) return;
      mounted = nextValue;
      __readerController.invalidate();
    },
    get checked() {
      return checked;
    },
    set checked(nextValue: typeof checked) {
      if (Object.is(checked, nextValue)) return;
      checked = nextValue;
      __readerController.invalidate();
    },
    get extensionPresent() {
      return extensionPresent;
    },
    set extensionPresent(nextValue: typeof extensionPresent) {
      if (Object.is(extensionPresent, nextValue)) return;
      extensionPresent = nextValue;
      __readerController.invalidate();
    },
    get bridgeReady() {
      return bridgeReady;
    },
    set bridgeReady(nextValue: typeof bridgeReady) {
      if (Object.is(bridgeReady, nextValue)) return;
      bridgeReady = nextValue;
      __readerController.invalidate();
    },
    get timer() {
      return timer;
    },
    set timer(nextValue: typeof timer) {
      if (Object.is(timer, nextValue)) return;
      timer = nextValue;
      __readerController.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if ('contentReady' in next) api.contentReady = next.contentReady as typeof contentReady;
    }
  };
  return api;
}
