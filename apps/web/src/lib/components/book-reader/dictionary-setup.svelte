<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';

  export let contentReady = false;

  const choiceKey = 'manabi-reader-dictionary-setup-v1';
  const setupUrl = 'https://manabitan.manabi.io/getting-started/#installation';
  let open = false;
  let mounted = false;
  let checked = false;
  let extensionPresent = false;
  let bridgeReady = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  export function show() {
    extensionPresent = manabitanPresent();
    bridgeReady = readerBridgeReady();
    open = true;
  }

  function savedChoice() {
    try {
      return localStorage.getItem(choiceKey);
    } catch {
      return null;
    }
  }

  function manabitanPresent() {
    const { dataset } = document.documentElement;
    return (
      dataset.manabitanContentScriptLoaded === 'true' ||
      dataset.manabitanContentScriptPrepared === 'true'
    );
  }

  function readerBridgeReady() {
    return document.documentElement.dataset.manabitanReaderJitendexBridge === 'true';
  }

  function choose(value: 'manabitan' | 'done' | 'other' | 'skip') {
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
      extensionPresent = manabitanPresent();
      bridgeReady = readerBridgeReady();
      const choice = savedChoice();
      if ((!choice && !extensionPresent) || (choice === 'manabitan' && bridgeReady)) open = true;
    }, 1200);
  }

  onMount(() => {
    mounted = true;
    const observer = new MutationObserver(() => {
      extensionPresent = manabitanPresent();
      bridgeReady = readerBridgeReady();
      if (contentReady && savedChoice() === 'manabitan' && bridgeReady) open = true;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        'data-manabitan-content-script-loaded',
        'data-manabitan-content-script-prepared',
        'data-manabitan-reader-jitendex-bridge'
      ]
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
    onCloseAutoFocus={() => {
      if (!savedChoice() && !manabitanPresent()) choose('skip');
    }}
  >
    <div class="flex items-center gap-3 pr-8">
      <img
        src="https://manabitan.manabi.io/assets/icon/manabitan-icon128.png"
        alt=""
        class="size-12 rounded-xl"
      />
      <Dialog.Title class="text-xl">Look up words as you read</Dialog.Title>
    </div>
    <Dialog.Description class="text-sm text-muted-foreground">
      Manabitan adds dictionary lookups to the book. Jitendex is a recommended Japanese dictionary.
    </Dialog.Description>
    <div class="grid gap-2">
      {#if bridgeReady}
        <Button
          data-manabitan-install-jitendex="true"
          variant="secondary"
          class="min-h-11 justify-center"
          onclick={() => choose('done')}>Install Jitendex</Button
        >
      {:else}
        <Button
          href={setupUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="secondary"
          class="min-h-11 justify-center"
          onclick={() => choose('manabitan')}
          >{extensionPresent ? 'Update Manabitan' : 'Get Manabitan'}</Button
        >
      {/if}
      <Button variant="outline" class="min-h-11" onclick={() => choose('other')}
        >Use another extension</Button
      >
      <Button variant="ghost" class="min-h-11" onclick={() => choose('skip')}>Not now</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
