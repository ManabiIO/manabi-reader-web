<script lang="ts">
  import { afterUpdate, createEventDispatcher } from 'svelte';

  export let html: string;

  const dispatch = createEventDispatcher<{
    load: void;
  }>();

  let displayedHtml: string | undefined;
  afterUpdate(() => {
    // Binding updates and font reflows are not new content loads. Re-emitting
    // here destroys the Reader's geometry/position owner for unchanged HTML.
    if (html === displayedHtml) return;
    displayedHtml = html;
    dispatch('load');
  });
</script>

{@html html}
