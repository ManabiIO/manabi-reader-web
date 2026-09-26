<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import { BookOpenIcon as BookOpen } from 'phosphor-svelte';
  import { loadEditorsPicks, type EditorsPick } from './editors-picks';

  export let openingId = '';
  export let embedded = false;
  export let headingId = 'editors-picks-heading';
  let picks: EditorsPick[] = [];
  let loading = true;
  let error = '';
  let mounted = false;
  let pageActive = true;
  let loadVersion = 0;
  let request: AbortController | undefined;

  function cancelLoad() {
    loadVersion += 1;
    request?.abort();
    request = undefined;
    loading = false;
  }

  function suspendLoad() {
    // Svelte can flush a queued onMount callback while the document departs.
    // Aborting an existing request alone cannot stop that callback starting one.
    pageActive = false;
    cancelLoad();
  }

  function resumeLoad() {
    pageActive = true;
    if (mounted && !request && !picks.length) void load();
  }

  function visibilityChanged() {
    if (document.visibilityState === 'hidden') cancelLoad();
    else if (pageActive && mounted && !request && !picks.length) void load();
  }
  beforeNavigate((navigation) => {
    // A same-route collection/view change can keep this component mounted.
    if (navigation.willUnload || navigation.to?.route.id !== navigation.from?.route.id)
      suspendLoad();
  });
  afterNavigate(resumeLoad);
  const dispatch = createEventDispatcher<{ open: EditorsPick }>();

  async function load() {
    if (!mounted || !pageActive || document.visibilityState === 'hidden') return;
    const version = ++loadVersion;
    request?.abort();
    const current = new AbortController();
    request = current;
    loading = true;
    error = '';
    try {
      const loaded = await loadEditorsPicks(window.location.origin, current.signal);
      if (mounted && version === loadVersion && !current.signal.aborted) picks = loaded;
    } catch (cause) {
      if (mounted && pageActive && version === loadVersion && !current.signal.aborted) {
        error = cause instanceof Error ? cause.message : 'The catalog could not be loaded.';
      }
    } finally {
      if (request === current) request = undefined;
      if (mounted && version === loadVersion) loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    void load();
    return () => {
      mounted = false;
      suspendLoad();
    };
  });
</script>

<svelte:window onpagehide={suspendLoad} onpageshow={resumeLoad} />
<svelte:document onvisibilitychange={visibilityChanged} />

<section
  aria-labelledby={headingId}
  class={embedded
    ? 'rounded-2xl border border-border/70 bg-muted/30 p-[16px] text-left sm:p-5'
    : 'text-left'}
>
  <div class="mb-3">
    <h3 id={headingId} class="text-base font-semibold">Editor's Picks</h3>
  </div>
  {#if loading}
    <p role="status" class="py-6 text-sm text-muted-foreground">Loading books…</p>
  {:else if error}
    <div role="status" class="py-4 text-sm">
      <p>Editor's Picks are unavailable right now.</p>
      <Button variant="outline" class="mt-3" onclick={resumeLoad}>Try Again</Button>
    </div>
  {:else if !picks.length}
    <p class="py-6 text-sm text-muted-foreground">No books are listed right now.</p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex: keyboard users need to scroll the bounded list -->
    <div
      aria-label="Editor's Picks books"
      role="region"
      tabindex="0"
      class={embedded
        ? 'max-h-[min(34rem,55dvh)] overflow-y-auto overscroll-contain pr-1'
        : 'max-h-[min(34rem,60dvh)] overflow-y-auto overscroll-contain pr-1'}
    >
      <div class="grid gap-3">
        {#each picks as pick (pick.id)}
          <article class="flex min-w-0 flex-wrap gap-[12px] rounded-xl border border-border/60 bg-background p-[12px]">
            <div
              class="flex h-[112px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted shadow-sm"
            >
              {#if pick.coverUrl}
                <img
                  src={pick.coverUrl}
                  alt=""
                  loading="lazy"
                  class="h-full w-full object-contain"
                />
              {:else}<BookOpen class="size-8 text-muted-foreground" aria-hidden="true" />{/if}
            </div>
            <div class="flex min-w-0 flex-[1_1_8rem] flex-col items-start">
              <h4 class="w-full line-clamp-2 text-sm font-semibold leading-snug">{pick.title}</h4>
              {#if pick.author}<p class="mt-1 text-xs text-muted-foreground">{pick.author}</p>{/if}
              {#if pick.summary}<p class="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {pick.summary}
                </p>{/if}
              <Button
                size="sm"
                variant="secondary"
                class="mt-auto min-h-9 self-end px-4"
                disabled={!!openingId}
                onclick={() => dispatch('open', pick)}
                >{openingId === pick.id ? 'Opening…' : 'Open'}</Button
              >
            </div>
          </article>
        {/each}
      </div>
    </div>
  {/if}
</section>
