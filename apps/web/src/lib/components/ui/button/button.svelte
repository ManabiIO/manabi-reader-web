<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

  export const buttonVariants = tv({
    base: "focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 aria-invalid:ring-3 motion-safe:active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center min-w-0 max-w-full whitespace-normal text-center [overflow-wrap:anywhere] transition-[color,background-color,border-color,box-shadow,transform,translate] outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background dark:bg-transparent hover:bg-muted hover:text-foreground dark:hover:bg-input/30 aria-expanded:bg-muted aria-expanded:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground',
        destructive:
          'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      // Compact and unbordered controls keep their own geometry. The larger
      // bordered styles opt into capsules below; touch hit areas do not decide shape.
      shape: {
        auto: '',
        rounded: '',
        capsule: 'rounded-full',
        circle: 'rounded-full aspect-square p-0'
      },
      size: {
        default:
          'min-h-10 rounded-[10px] gap-2 px-4 py-2 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "min-h-7 rounded-[6px] gap-1 px-2.5 py-1 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: 'min-h-8 rounded-[8px] gap-1 px-3 py-1 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        lg: 'min-h-11 rounded-[12px] gap-2 px-5 py-2.5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
        icon: 'size-10 rounded-[10px] p-0',
        'icon-xs': "size-7 rounded-[6px] p-0 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 rounded-[8px] p-0',
        'icon-lg': 'size-11 rounded-[12px] p-0'
      }
    },
    compoundVariants: [
      {
        shape: 'auto',
        variant: ['default', 'secondary', 'outline', 'destructive'],
        size: ['default', 'lg'],
        class: 'rounded-full'
      },
      // Keep explicit shapes authoritative over the size's default radius.
      { shape: ['capsule', 'circle'], class: 'rounded-full' }
    ],
    defaultVariants: {
      shape: 'auto',
      variant: 'default',
      size: 'default'
    }
  });

  export type ButtonShape = VariantProps<typeof buttonVariants>['shape'];
  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
  export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
      shape?: ButtonShape;
    };
</script>

<script lang="ts">
  let {
    class: className,
    variant = 'default',
    size = 'default',
    shape = 'auto',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#if href}
  <!-- The caller owns URL resolution: resolving an already based URL here can
       double-prefix the application base and would also break external links. -->
  <!-- eslint-disable svelte/no-navigation-without-resolve -->
  <a
    bind:this={ref}
    data-slot="button"
    data-variant={variant}
    data-size={size}
    data-shape={shape}
    class={cn(buttonVariants({ variant, size, shape }), className)}
    href={disabled ? undefined : href}
    {...restProps}
    aria-disabled={disabled || restProps['aria-disabled']}
    role={disabled ? 'link' : restProps.role}
    tabindex={disabled ? -1 : restProps.tabindex}
    onclick={(event) => {
      if (disabled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const onClick: HTMLAnchorAttributes['onclick'] = restProps.onclick;
      onClick?.(event);
    }}
  >
    {@render children?.()}
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    data-variant={variant}
    data-size={size}
    data-shape={shape}
    class={cn(buttonVariants({ variant, size, shape }), className)}
    {type}
    {disabled}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
