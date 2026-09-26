<script lang="ts">
  import { pageTurnEffect$ } from '$lib/data/page-turn-preferences';
  import { normalizePageTurnEffect } from '$lib/foliate-epub/page-turn-effect';
</script>

<label class="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm">
  <span>Page turn effect</span>
  <select
    aria-label="Page turn effect"
    class="min-h-11 rounded-lg border border-border bg-background px-3 text-foreground"
    value={$pageTurnEffect$}
    onchange={(event) => pageTurnEffect$.next(normalizePageTurnEffect(event.currentTarget.value))}
  >
    <option value="slide">Slide</option>
    <option value="none">None</option>
  </select>
</label>
<p class="mt-2 text-xs text-muted-foreground">
  Paginated EPUBs: slide over the next page, or change pages instantly. Scrolling is unchanged.
</p>
