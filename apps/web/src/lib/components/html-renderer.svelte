<script lang="ts">
  import { afterUpdate, createEventDispatcher, onDestroy, tick } from 'svelte';

  export let html: string;

  const dispatch = createEventDispatcher<{
    load: void;
  }>();

  let displayedHtml: string | undefined;
  let generation = 0;
  let disposed = false;
  afterUpdate(() => {
    // Binding updates and font reflows are not new content loads. Re-emitting
    // here destroys the Reader's geometry/position owner for unchanged HTML.
    if (html === displayedHtml) return;
    displayedHtml = html;
    const current = ++generation;
    // Child afterUpdate can run before a parent's bind:this has been assigned.
    // Notify only after that flush, and only for the current mounted content.
    void tick().then(() => {
      if (!disposed && generation === current) dispatch('load');
    });
  });
  onDestroy(() => {
    disposed = true;
    generation += 1;
  });
</script>

{@html html}
