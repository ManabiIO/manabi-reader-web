<script lang="ts">
  // Only the search engine knows which occurrence a result represents. Never
  // re-search the preview with a regex or inject book text as HTML.
  export let text = '';
  export let match: { start: number; end: number } | undefined = undefined;

  $: valid =
    match &&
    Number.isInteger(match.start) &&
    Number.isInteger(match.end) &&
    match.start >= 0 &&
    match.end > match.start &&
    match.end <= text.length;
</script>

<bdi dir="auto" data-search-excerpt
  >{#if valid && match}{text.slice(0, match.start)}<mark>{text.slice(match.start, match.end)}</mark
    >{text.slice(match.end)}{:else}{text}{/if}</bdi
>

<style>
  bdi {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  mark {
    /* Preserve the theme's readable text pair. The underline and heavier
       weight identify the match independently of tint or color perception. */
    color: var(--foreground);
    background: color-mix(in srgb, var(--primary) 14%, var(--background));
    font-weight: 650;
    border-block-end: 2px solid var(--primary);
    border-radius: 2px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  @media (forced-colors: active) {
    mark {
      color: MarkText;
      background: Mark;
      border-color: MarkText;
    }
  }
</style>
