<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { SvelteSet } from 'svelte/reactivity';
  import { page } from '$app/stores';
  import { Button } from '$lib/components/ui/button';
  import { snippetItems, scope } from './service';
  import { fold, snippetKey, type SnippetHit } from './document';
  import { searchBodies } from './search';
  import { saveLabel } from './presentation';
  import type { SnippetSummary } from './summary';
  export let query = '';
  export let members: string[] | undefined = undefined;
  export let returnTo: string | undefined = undefined;
  export let showEmpty = true;
  export let source = '';
  export let trashed = false;
  export let layout: 'list' | 'grid' = 'list';
  export let sort: 'edited' | 'read' | 'created' | 'title' = 'edited';
  export let selecting = false;
  export let selected: ReadonlySet<string> = new Set();
  export let onselect: (ids: string[]) => void = () => undefined;
  export let onvisible: (ids: string[]) => void = () => undefined;
  export let onchoose: ((item: SnippetSummary) => void) | undefined = undefined;
  let mounted = false,
    signature = '',
    visibleSignature = '',
    limit = 60,
    anchor = '';
  let stop: () => void = () => undefined;
  let hits = new Map<string, SnippetHit[]>(),
    searching = false,
    failed = 0,
    truncated = false;
  const sourceIdentity = (item: SnippetSummary) =>
    item.destination
      ? JSON.stringify([
          item.destination.source.owner,
          item.destination.source.id,
          item.destination.source.root
        ])
      : 'device';
  $: eligible = $snippetItems.filter(
    (item) =>
      !!item.trashedAt === trashed &&
      (!members || members.includes(snippetKey(item.id))) &&
      (!source || sourceIdentity(item) === source)
  );
  $: needle = fold(query.trim());
  $: nextSignature = JSON.stringify([
    query,
    trashed,
    eligible.map((item) => [item.key, item.revision])
  ]);
  $: if (mounted && signature !== nextSignature) {
    signature = nextSignature;
    start();
  }
  $: visible = eligible
    .filter((item) => !needle || fold(item.title).includes(needle) || hits.has(item.id))
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'ja')
        : sort === 'read'
          ? (b.readAt ?? 0) - (a.readAt ?? 0)
          : sort === 'created'
            ? b.createdAt - a.createdAt
            : b.modifiedAt - a.modifiedAt
    );
  $: nextVisibleSignature = JSON.stringify(visible.map((item) => item.id));
  $: if (nextVisibleSignature !== visibleSignature) {
    visibleSignature = nextVisibleSignature;
    onvisible(visible.map((item) => item.id));
  }
  $: if (!selecting && anchor) anchor = '';
  function start() {
    stop();
    hits = new Map();
    failed = 0;
    truncated = false;
    limit = 60;
    searching = false;
    if (!query.trim() || query.length > 512) return;
    try {
      stop = searchBodies(
        query,
        eligible.map((item) => item.id),
        scope(),
        (state) => {
          hits = state.hits;
          searching = state.busy;
          failed = state.failed;
          truncated = state.truncated;
        }
      );
    } catch {
      failed = 1;
    }
  }
  function url(item: SnippetSummary, hit?: SnippetHit) {
    const q = new URLSearchParams({
      id: item.id,
      returnTo: returnTo ?? $page.url.pathname + $page.url.search
    });
    if (hit) q.set('locator', JSON.stringify(hit.locator));
    return `/snippets?${q}` as const;
  }
  function choose(event: MouseEvent, item: SnippetSummary) {
    if (!selecting && !event.shiftKey && !event.metaKey && !event.ctrlKey && !onchoose) return;
    event.preventDefault();
    if (onchoose) {
      onchoose(item);
      return;
    }
    const next = new SvelteSet(selected);
    if (event.shiftKey && anchor) {
      const a = visible.findIndex((i) => i.id === anchor),
        b = visible.findIndex((i) => i.id === item.id);
      if (a >= 0 && b >= 0) {
        for (const entry of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(entry.id);
      } else {
        next.add(item.id);
        anchor = item.id;
      }
    } else {
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      anchor = item.id;
    }
    onselect([...next]);
  }
  onMount(() => {
    mounted = true;
    return () => {
      mounted = false;
      stop();
    };
  });
</script>

{#if query.length > 512}<p role="alert">Use a search of 512 characters or fewer.</p>{/if}
{#if searching}<p class="search-note" role="status">
    Searching snippet contents… Title matches are ready.
  </p>{/if}
{#if failed}<p class="search-note" role="status">
    Some snippet contents could not be searched. Title matches are still available.
  </p>{/if}
<div
  class:grid={layout === 'grid'}
  class="snippet-shelf"
  role="list"
  aria-label={query ? 'Snippet search results' : 'Snippets'}
>
  {#each visible.slice(0, limit) as item (item.key)}
    <div class="snippet-card" class:selected={selected.has(item.id)} role="listitem">
      {#if selecting}<label class="select"
          ><input
            class="size-5 accent-primary"
            type="checkbox"
            checked={selected.has(item.id)}
            aria-label={`Select ${item.title}`}
            onchange={() => {
              const next = new SvelteSet(selected);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              anchor = item.id;
              onselect([...next]);
            }}
          /></label
        >{/if}
      <div class="content">
        <a class="title" href={resolve(url(item))} onclick={(event) => choose(event, item)}
          >{item.title}</a
        >
        <p class="excerpt">{item.excerpt || 'Empty snippet'}</p>
        <p class="metadata">
          <span>{new Date(item.modifiedAt).toLocaleDateString()}</span><span>{saveLabel(item)}</span
          >{#if item.destination}<span>{item.destination.source.name}</span>{/if}
        </p>
        {#if item.issue}<p class="issue">{item.issue}</p>{/if}
        {#each hits.get(item.id) ?? [] as hit, index (`${item.revision}:${index}`)}
          <a class="passage" href={resolve(url(item, hit))} onclick={(event) => choose(event, item)}
            >{hit.excerpt}{#if hit.reading}<span class="reading-label">Furigana match</span>{/if}</a
          >
        {/each}
      </div>
    </div>
  {:else}{#if showEmpty}<p class="empty">
        {searching
          ? 'Searching…'
          : query
            ? 'No matching snippets.'
            : trashed
              ? 'Trash is empty.'
              : 'No snippets here yet. Create one or refresh your connected libraries.'}
      </p>{/if}{/each}
</div>
{#if visible.length > limit}<Button variant="ghost" onclick={() => (limit += 60)}
    >Show more snippets</Button
  >{/if}
{#if truncated}<p role="status">
    Showing the first 1,000 matching snippets. Refine your search for more specific results.
  </p>{/if}

<style>
  .snippet-shelf {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
  .snippet-shelf.grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
  }
  .snippet-card {
    display: flex;
    gap: 0.8rem;
    padding: 1.1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--card);
    min-width: 0;
  }
  .snippet-card.selected {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
    background: var(--muted);
  }
  .content {
    min-width: 0;
    flex: 1;
  }
  .title {
    display: block;
    font-size: 1.15rem;
    font-weight: 650;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .title:hover {
    text-decoration: underline;
  }
  .title:focus-visible,
  .passage:focus-visible {
    border-radius: 0.5rem;
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .excerpt {
    margin-top: 0.4rem;
    line-height: 1.8;
    color: var(--muted-foreground);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.7rem;
    margin-top: 0.7rem;
    font-size: 0.78rem;
    color: var(--muted-foreground);
  }
  .passage {
    display: block;
    padding: 0.5rem 0.7rem;
    margin-top: 0.5rem;
    border-inline-start: 2px solid var(--border);
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  .passage:hover {
    background: var(--muted);
  }
  .reading-label {
    display: block;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .issue {
    font-size: 0.8rem;
    margin-top: 0.5rem;
    color: var(--muted-foreground);
  }
  .empty,
  .search-note {
    padding: 0.65rem;
    color: var(--muted-foreground);
  }
  .select {
    padding-top: 0.3rem;
  }
  .select input {
    width: 1.2rem;
    height: 1.2rem;
    accent-color: var(--primary);
  }
</style>
