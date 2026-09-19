<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { refreshAccount } from './client';
  import { startPreferenceSync } from './preferences';
  import { bookSyncStatus, startBookSync } from './books';

  $: needsAttention = Object.values($bookSyncStatus).some((status) =>
    ['conflict', 'needs_reconnect', 'permission_required', 'unauthorized'].includes(status.state)
  );
  onMount(() => {
    const stopPreferences = startPreferenceSync();
    const stopBooks = startBookSync();
    const refresh = () => {
      void refreshAccount();
    };
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      stopPreferences();
      stopBooks();
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

{#if needsAttention && $page.url.pathname !== `${base}/connections`}
  <aside role="status">
    <a href="{base}/connections">Reading sync needs attention. Your local reading data is safe.</a>
  </aside>
{/if}

<style>
  aside {
    position: fixed;
    bottom: 3.5rem;
    right: 1rem;
    z-index: 30;
    max-width: 22rem;
    padding: 0.65rem 1rem;
    border-radius: 0.5rem;
    background: var(--surface-raised);
    color: var(--ink);
    border: 1px solid var(--line);
    box-shadow: 0 2px 8px #0003;
    font:
      14px/1.4 system-ui,
      sans-serif;
    writing-mode: horizontal-tb;
  }
  a {
    text-decoration: underline;
  }
</style>
