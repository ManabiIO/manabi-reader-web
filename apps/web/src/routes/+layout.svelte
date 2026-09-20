<script lang="ts">
  import { browser } from '$app/environment';
  import { sanitizeDialogHtml } from '$lib/functions/book-security/dialog-content-security';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { onDestroy, onMount } from 'svelte';
  import ManabiRuntime from '$lib/manabi/runtime.svelte';
  import { basePath, clearConsoleOnReload } from '$lib/data/env';
  import { dialogManager, type Dialog } from '$lib/data/dialog-manager';
  import { userFontsCacheName, type UserFont } from '$lib/data/fonts';
  import { fontFamilyGroupOne$, isOnline$, userFonts$ } from '$lib/data/store';
  import { dummyFn, isMobile, isMobile$ } from '$lib/functions/utils';
  import AppearanceRuntime from '$lib/appearance/runtime.svelte';
  import { buildLocalFontStyleSheet } from '$lib/functions/book-security/local-media';
  import {
    detectYuKyokashoAvailability,
    normalizePrimaryReaderFont
  } from '$lib/data/reader-typography';
  import { MetaTags } from 'svelte-meta-tags';
  import '../app.scss';

  let path = '';
  let dialogs: Dialog[] = [];
  let clickOnCloseDisabled = false;
  let zIndex = '';
  let yuKyokashoAvailable: boolean | undefined;

  $: if (browser) {
    isMobile$.next(isMobile(window));
    addUserFonts($userFonts$);
  }

  // "YuKyokasho" is a real local-font choice, not a synthetic system alias.
  // Keep it selected only while this browser can actually activate either native variant.
  $: if (browser && yuKyokashoAvailable !== undefined) {
    const normalized = normalizePrimaryReaderFont($fontFamilyGroupOne$, yuKyokashoAvailable);
    if (normalized !== $fontFamilyGroupOne$) fontFamilyGroupOne$.next(normalized);
  }

  onMount(() => {
    let active = true;
    void detectYuKyokashoAvailability().then((available) => {
      if (active) yuKyokashoAvailable = available;
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

  const dialogsSubscription = dialogManager.dialogs$.subscribe((d) => {
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

<svelte:window bind:online={$isOnline$} />

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

{#if dialogs.length > 0}
  <div class="writing-horizontal-tb fixed inset-0 z-50 h-full w-full" style:z-index={zIndex}>
    <div
      tabindex="0"
      role="button"
      class="tap-highlight-transparent absolute inset-0 bg-black/[.32]"
      on:click={() => {
        if (!clickOnCloseDisabled) {
          closeAllDialogs();
        }
      }}
      on:keyup={dummyFn}
    ></div>

    <div
      class="relative top-1/2 left-1/2 inline-block max-w-[80vw] -translate-x-1/2 -translate-y-1/2"
    >
      {#each dialogs as dialog}
        {#if typeof dialog.component === 'string'}
          {@html browser ? sanitizeDialogHtml(dialog.component, document) : ''}
        {:else}
          <svelte:component this={dialog.component} {...dialog.props} on:close={closeAllDialogs} />
        {/if}
      {/each}
    </div>
  </div>
{/if}
