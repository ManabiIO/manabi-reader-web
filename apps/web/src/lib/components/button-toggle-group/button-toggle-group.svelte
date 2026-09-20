<script lang="ts">
  import { createEventDispatcher, getContext } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { SETTINGS_FIELD } from '$lib/components/settings/settings-context';
  import type { ToggleOption } from './toggle-option';
  import { availableThemes } from '$lib/data/theme-option';
  export let options: ToggleOption<any>[];
  export let selectedOptionId: any;
  export let invertColors = false;
  const fieldName = getContext<() => string>(SETTINGS_FIELD) ?? (() => 'Option');
  const dispatch = createEventDispatcher<{ edit: string; delete: string }>();
  $: isBoolean =
    options.length === 2 &&
    options.some((o) => o.id === true) &&
    options.some((o) => o.id === false);
  function styles(style: Record<string, any> | undefined) {
    return style
      ? Object.entries(style)
          .map(([key, value]) => `${key}: ${value}`)
          .join(';')
      : '';
  }
</script>

{#if isBoolean}
  <div class="flex min-h-9 items-center gap-3">
    <Switch
      aria-label={fieldName()}
      checked={selectedOptionId === true}
      onCheckedChange={(value) => (selectedOptionId = value)}
    />
    <span class="text-sm text-muted-foreground">{selectedOptionId ? 'On' : 'Off'}</span>
  </div>
{:else}
  <div
    role="group"
    aria-label={fieldName()}
    class="flex flex-wrap gap-2"
    class:legacy-invert={invertColors}
  >
    {#each options as option (option.id)}
      <div class="flex flex-wrap items-center gap-1">
        <Button
          title={String(option.id)}
          variant={option.id === selectedOptionId ? 'secondary' : 'outline'}
          class={option.id === selectedOptionId ? 'border-2 border-primary' : 'border-border'}
          aria-pressed={option.id === selectedOptionId}
          style={styles(option.style)}
          onclick={() => (selectedOptionId = option.id)}>{option.text}</Button
        >
        {#if option.showIcons && option.id === selectedOptionId && !availableThemes.has(option.id)}
          <Button
            variant="ghost"
            aria-label={`Edit ${option.text} theme`}
            onclick={() => dispatch('edit', option.id)}>Edit</Button
          >
          <Button
            variant="ghost"
            aria-label={`Delete ${option.text} theme`}
            onclick={() => dispatch('delete', option.id)}>Delete</Button
          >
        {/if}
      </div>
    {/each}
    <slot />
  </div>
{/if}
