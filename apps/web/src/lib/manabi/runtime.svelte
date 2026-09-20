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
    let lastRefreshStarted = 0;
    const refresh = (force = false) => {
      const now = Date.now();
      // Refocusing a newly mounted page must not start a duplicate request. In
      // WebKit that request can surface as a CORS page error if the tab closes.
      if (!force && now - lastRefreshStarted < 30_000) return;
      lastRefreshStarted = now;
      void refreshAccount();
    };
    const refreshOnline = () => refresh(true);
    const refreshFocus = () => refresh();
    refresh(true);
    window.addEventListener('online', refreshOnline);
    window.addEventListener('focus', refreshFocus);
    return () => {
      stopPreferences();
      stopBooks();
      window.removeEventListener('online', refreshOnline);
      window.removeEventListener('focus', refreshFocus);
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
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
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
