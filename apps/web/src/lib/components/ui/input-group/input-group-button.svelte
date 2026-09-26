<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';

  const inputGroupButtonVariants = tv({
    base: 'gap-2 text-sm flex items-center shadow-none',
    variants: {
      size: {
        xs: "h-7 gap-1 rounded-[6px] px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
        sm: '',
        'icon-xs': 'size-7 rounded-[6px] p-0 has-[>svg]:p-0',
        'icon-sm': 'size-8 p-0 has-[>svg]:p-0'
      }
    },
    defaultVariants: {
      size: 'xs'
    }
  });

  export type InputGroupButtonSize = VariantProps<typeof inputGroupButtonVariants>['size'];
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';
  import type { ComponentProps } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    children,
    type = 'button',
    variant = 'ghost',
    size = 'xs',
    ...restProps
  }: Omit<ComponentProps<typeof Button>, 'href' | 'size'> & {
    size?: InputGroupButtonSize;
  } = $props();
</script>

<Button
  bind:ref
  {type}
  data-size={size}
  {variant}
  {size}
  shape="rounded"
  class={cn(inputGroupButtonVariants({ size }), className)}
  {...restProps}
>
  {@render children?.()}
</Button>
