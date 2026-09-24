<script lang="ts">
  import { XIcon } from 'phosphor-svelte';
  import { Button, type ButtonProps } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';

  let {
    ref = $bindable(null),
    class: className,
    'aria-label': label = 'Close',
    ...restProps
  }: Omit<ButtonProps, 'children' | 'variant' | 'size' | 'shape' | 'href'> = $props();
</script>

<Button
  bind:ref
  {...restProps}
  variant="secondary"
  size="icon-lg"
  shape="circle"
  aria-label={label}
  data-modal-dismiss=""
  class={cn(
    'text-muted-foreground hover:text-foreground',
    className
  )}
>
  <XIcon class="size-[18px]" weight="bold" aria-hidden="true" />
</Button>
