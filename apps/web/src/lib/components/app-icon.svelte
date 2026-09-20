<script lang="ts">
  import type { IconDefinition } from './icon-types';
  export let icon: IconDefinition;
  export let spin = false;
  export let style = '';
  let className = '';
  export { className as class };
</script>

<svelte:component
  this={icon}
  size="1em"
  strokeWidth={1.75}
  aria-hidden="true"
  class={`${className} ${spin ? 'animate-spin motion-reduce:animate-none' : ''}`}
  {style}
/>
