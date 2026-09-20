<script lang="ts">
  import * as Modal from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { browser } from '$app/environment';
  import { sanitizeDialogHtml } from '$lib/functions/book-security/dialog-content-security';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { onDestroy, onMount } from 'svelte';
  import ManabiRuntime from '$lib/manabi/runtime.svelte';
  import { basePath, clearConsoleOnReload } from '$lib/data/env';
  import { dialogManager, type Dialog } from '$lib/data/dialog-manager';
  import { userFontsCacheName, type UserFont } from '$lib/data/fonts';
  import {
    fontFamilyGroupOne$,
    isOnline$,
    userFonts$,
    yuKyokashoAvailable$
  } from '$lib/data/store';
  import { isMobile, isMobile$ } from '$lib/functions/utils';
  import AppearanceRuntime from '$lib/appearance/runtime.svelte';
  import { buildLocalFontStyleSheet } from '$lib/functions/book-security/local-media';
  import {
    detectYuKyokashoAvailability,
    LEGACY_SYSTEM_JAPANESE,
    YU_KYOKASHO
  } from '$lib/data/reader-typography';
  import { MetaTags } from 'svelte-meta-tags';
  import '../app.css';
  import '../app.scss';

  let path = '';
  let dialogs: Dialog[] = [];
  let clickOnCloseDisabled = false;
  let zIndex = '';
  let lastPointerTarget: HTMLElement | undefined;
  let dialogReturnFocus: HTMLElement | undefined;

  $: if (browser) {
    isMobile$.next(isMobile(window));
    addUserFonts($userFonts$);
  }

  // Migrate only the released synthetic name. Device capability is resolved
  // separately so a local fallback can never overwrite a synced preference.
  $: if (browser && $fontFamilyGroupOne$ === LEGACY_SYSTEM_JAPANESE) {
    fontFamilyGroupOne$.next(YU_KYOKASHO);
  }

  onMount(() => {
    let active = true;
    void detectYuKyokashoAvailability().then((available) => {
      if (active) yuKyokashoAvailable$.next(available);
    });
    return () => {
      active = false;
    };
  });

  if (clearConsoleOnReload && import.meta.hot) {
    // eslint-disable-next-line no-console
    import.meta.hot.on('vite:beforeUpdate', () => console.clear());
  }

  function addUserFonts(userFonts: UserFont[]) {
    const styleContent = buildLocalFontStyleSheet(userFonts);

    let styleElement = document.getElementById(userFontsCacheName);

    if (!styleContent) {
      styleElement?.remove();
      return;
    }

    const textNode = document.createTextNode(styleContent);

    if (styleElement) {
      styleElement.replaceChildren(textNode);
    } else {
      styleElement = document.createElement('style');
      styleElement.id = userFontsCacheName;

      styleElement.appendChild(textNode);
      document.head.append(styleElement);
    }
  }

  function closeAllDialogs() {
    dialogManager.dialogs$.next([]);
    clickOnCloseDisabled = false;
    zIndex = '';
  }

  function rememberPointerTarget(event: PointerEvent) {
    if (dialogs.length || !(event.target instanceof HTMLElement)) return;
    lastPointerTarget =
      event.target.closest<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? event.target;
  }

  const dialogsSubscription = dialogManager.dialogs$.subscribe((d) => {
    if (browser && !dialogs.length && d.length) {
      const active = document.activeElement;
      dialogReturnFocus =
        active instanceof HTMLElement && active !== document.body
          ? active
          : lastPointerTarget?.isConnected
            ? lastPointerTarget
            : undefined;
    }
    clickOnCloseDisabled = d[0]?.disableCloseOnClick ?? false;
    zIndex = d[0]?.zIndex ?? '';
    dialogs = d;
  });

  const stopPage = page.subscribe((p) => (path = p.url.pathname));
  onDestroy(() => {
    dialogsSubscription.unsubscribe();
    stopPage();
  });
</script>

<svelte:window bind:online={$isOnline$} on:pointerdown|capture={rememberPointerTarget} />

<MetaTags
  title="Manabi Reader"
  description="Local-first e-book reader with support for Japanese dictionary extensions"
  canonical="{basePath}{path !== '/' ? path : ''}"
  openGraph={{
    type: 'website',
    images: [
      {
        url: `${basePath}${base}/icons/regular-icon@512x512.png`,
        width: 512,
        height: 512
      }
    ]
  }}
/>
<AppearanceRuntime />
<ManabiRuntime />
<slot />

<Modal.Root
  open={dialogs.length > 0}
  onOpenChange={(open) => {
    if (!open) closeAllDialogs();
  }}
>
  {#if dialogs.length > 0}
    <Modal.Content
      showCloseButton={false}
      class="max-h-[90dvh] overflow-y-auto p-0 pt-12 sm:max-w-3xl"
      style={`z-index: ${zIndex || '60'}`}
      onInteractOutside={(event) => {
        if (clickOnCloseDisabled) event.preventDefault();
      }}
      onEscapeKeydown={(event) => {
        if (clickOnCloseDisabled) event.preventDefault();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        dialogReturnFocus?.focus();
        dialogReturnFocus = undefined;
      }}
    >
      <Modal.Title class="sr-only">Reader dialog</Modal.Title>
      <Modal.Description class="sr-only"
        >Adjust the options below, then confirm or cancel.</Modal.Description
      >
      {#each dialogs as dialog}
        {#if typeof dialog.component === 'string'}
          <div class="p-6">
            {@html browser ? sanitizeDialogHtml(dialog.component, document) : ''}
          </div>
        {:else}
          <svelte:component this={dialog.component} {...dialog.props} on:close={closeAllDialogs} />
        {/if}
      {/each}
      {#if !clickOnCloseDisabled}<Button
          variant="ghost"
          class="absolute top-2 right-2"
          onclick={closeAllDialogs}>Close</Button
        >{/if}
    </Modal.Content>
  {/if}
</Modal.Root>
