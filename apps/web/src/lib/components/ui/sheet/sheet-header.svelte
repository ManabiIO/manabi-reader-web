<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="sheet-header"
  class={cn('gap-1.5 p-6 in-data-[modal-close=true]:p-0 flex min-w-0 flex-col', className)}
  {...restProps}
>
  {@render children?.()}
</div>
