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
    min-width: 0;
    min-height: 44px;
    padding: 10px 22px;
    border-radius: 20px;
    color: var(--foreground);
    text-align: center;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  @media (max-width: 480px) {
    a {
      padding-inline: 12px;
    }
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
