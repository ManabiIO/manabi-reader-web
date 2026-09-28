<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { reservedFontNames } from '$lib/data/fonts';
  import { userFonts$ } from '$lib/data/store';
  import { fontActionError, saveUserFont } from './user-font-actions';

  export let isLoading = false;
  export let fontCache: Cache;

  const dispatch = createEventDispatcher<{ saved: void }>();
  const formId = `custom-font-${crypto.randomUUID()}`;
  let fileElement: HTMLInputElement | null = null;
  let fontName = '';
  let fontFile: File | undefined;
  let currentError = '';
  let alive = true;

  onDestroy(() => {
    alive = false;
  });

  function handleFileChange(event: Event) {
    fontFile = (event.currentTarget as HTMLInputElement).files?.[0];
    currentError = '';
  }

  async function addFont() {
    if (isLoading || !alive) return;
    isLoading = true;
    currentError = '';
    try {
      await saveUserFont(
        fontCache,
        { read: () => userFonts$.getValue(), write: (fonts) => userFonts$.next(fonts) },
        fontName,
        fontFile,
        reservedFontNames
      );
      if (!alive) return;
      fontName = '';
      fontFile = undefined;
      if (fileElement) fileElement.value = '';
      isLoading = false;
      dispatch('saved');
    } catch (error) {
      if (alive) currentError = fontActionError(error);
    } finally {
      if (alive) isLoading = false;
    }
  }
</script>

<form class="min-w-0 space-y-4" on:submit|preventDefault={addFont} aria-busy={isLoading}>
  <label for={`${formId}-name`} class="block min-w-0 text-sm font-medium">
    Font name
    <Input
      id={`${formId}-name`}
      class="mt-2"
      type="text"
      required
      maxlength={200}
      disabled={isLoading}
      bind:value={fontName}
      oninput={() => (currentError = '')}
      onkeydown={(event) => {
        if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
      }}
    />
  </label>
  <label for={`${formId}-file`} class="block min-w-0 text-sm font-medium">
    Font file
    <Input
      id={`${formId}-file`}
      class="mt-2"
      type="file"
      required
      disabled={isLoading}
      accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
      bind:ref={fileElement}
      onchange={handleFileChange}
    />
  </label>
  <p class="text-sm text-muted-foreground">
    WOFF2, WOFF, TTF, or OTF. The file is saved only in this browser; it is not uploaded to your account.
  </p>
  {#if currentError}<p role="alert" class="break-words text-sm text-destructive">{currentError}</p>{/if}
  <div class="flex flex-wrap items-center justify-end gap-3">
    {#if isLoading}<p role="status" class="text-sm text-muted-foreground">Saving font…</p>{/if}
    <Button class="min-h-11" type="submit" disabled={isLoading}>Save font</Button>
  </div>
</form>
