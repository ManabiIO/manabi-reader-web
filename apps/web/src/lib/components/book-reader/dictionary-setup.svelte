<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import {
    DICTIONARY_EXTENSION_MUTATION_ATTRIBUTES,
    markPreferredDefaultDictionaryInstall,
    normalizeDictionarySetupChoice,
    PREFERRED_DICTIONARY_EXTENSION_DESCRIPTION,
    PREFERRED_DICTIONARY_EXTENSION_NAME,
    PREFERRED_DICTIONARY_EXTENSION_SETUP_URL,
    preferredDictionaryExtensionPresent,
    preferredDictionaryReaderBridgeReady,
    type DictionarySetupChoice
  } from '$lib/integrations/external-dictionary-interop';

  export let contentReady = false;

  const choiceKey = 'manabi-reader-dictionary-setup-v1';
  let open = false;
  let mounted = false;
  let checked = false;
  let extensionPresent = false;
  let bridgeReady = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  export function show() {
    extensionPresent = preferredDictionaryExtensionPresent(document);
    bridgeReady = preferredDictionaryReaderBridgeReady(document);
    open = true;
  }

  function savedChoice() {
    try {
      return normalizeDictionarySetupChoice(localStorage.getItem(choiceKey));
    } catch {
      return null;
    }
  }

  function choose(value: DictionarySetupChoice) {
    try {
      localStorage.setItem(choiceKey, value);
    } catch {
      // Private browsing can deny storage. The current prompt still closes.
    }
    open = false;
  }

  $: if (mounted && contentReady && !checked) {
    checked = true;
    timer = setTimeout(() => {
      extensionPresent = preferredDictionaryExtensionPresent(document);
      bridgeReady = preferredDictionaryReaderBridgeReady(document);
      const choice = savedChoice();
      if ((!choice && !extensionPresent) || (choice === 'preferred' && bridgeReady)) open = true;
    }, 1200);
  }

  onMount(() => {
    mounted = true;
    const observer = new MutationObserver(() => {
      extensionPresent = preferredDictionaryExtensionPresent(document);
      bridgeReady = preferredDictionaryReaderBridgeReady(document);
      if (contentReady && savedChoice() === 'preferred' && bridgeReady) open = true;
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
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="writing-horizontal-tb sm:max-w-lg"
    onCloseAutoFocus={(event) => {
      if (!savedChoice() && !preferredDictionaryExtensionPresent(document)) choose('skip');
      const controls = document.querySelector<HTMLButtonElement>('button[data-reader-controls]');
      if (controls) {
        event.preventDefault();
        controls.focus({ preventScroll: true });
      }
    }}
  >
    <Dialog.Header>
      <Dialog.Title class="text-xl">Look up words as you read</Dialog.Title>
      <Dialog.Description class="text-sm text-muted-foreground">
        {PREFERRED_DICTIONARY_EXTENSION_DESCRIPTION}
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-2">
      {#if bridgeReady}
        <Button
          use:markPreferredDefaultDictionaryInstall
          variant="secondary"
          class="min-h-11 justify-center"
          onclick={() => choose('done')}>Install Jitendex</Button
        >
      {:else}
        <Button
          href={PREFERRED_DICTIONARY_EXTENSION_SETUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          variant="secondary"
          class="min-h-11 justify-center"
          onclick={() => choose('preferred')}
          >{extensionPresent
            ? `Update ${PREFERRED_DICTIONARY_EXTENSION_NAME}`
            : `Get ${PREFERRED_DICTIONARY_EXTENSION_NAME}`}</Button
        >
      {/if}
      <Button variant="outline" class="min-h-11" onclick={() => choose('other')}
        >Use another extension</Button
      >
      <Button variant="ghost" class="min-h-11" onclick={() => choose('skip')}>Not now</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
