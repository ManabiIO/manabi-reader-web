<script lang="ts">
  import { base } from '$app/paths';
</script>

<nav aria-label="Library sections" class="media-library-tabs">
  <a href={`${base}/manage`} aria-current="page">Books</a>
  <a href={`${base}/videos`}>Videos</a>
</nav>

<style>
  .media-library-tabs {
    display: flex;
    flex-wrap: wrap;
    pointer-events: auto;
    gap: 6px;
    width: max-content;
    max-width: calc(100% - 48px);
    margin: 8px 24px 12px;
    padding: 4px;
    border-radius: 24px;
    background: var(--muted);
    font:
      0.9375rem/1.4 system-ui,
      sans-serif;
  }
  a {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 0 auto;
    max-width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 10px clamp(10px, 3vw, 22px);
    white-space: nowrap;
    text-align: center;
    border-radius: 20px;
    color: var(--foreground);
    text-decoration: none;
  }
  a[aria-current] {
    background: var(--card);
    font-weight: 650;
  }
  a:focus-visible {
    outline: 3px solid var(--ring);
    outline-offset: 2px;
  }
</style>
