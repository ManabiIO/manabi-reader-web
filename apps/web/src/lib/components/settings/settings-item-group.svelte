<script lang="ts">
  import { getContext, setContext } from 'svelte';
  import { readable } from 'svelte/store';
  import * as Field from '$lib/components/ui/field';
  import {
    SETTINGS_FILTER,
    SETTINGS_FIELD,
    matchesSetting,
    type SettingsFilterStore
  } from './settings-context';
  export let title: string;
  export let tooltip = '';
  export let applyHeaderClasses = true;
  export let category = 'all';
  export let settingId = '';
  export let keywords = '';
  export let showHeading = true;
  const filter =
    getContext<SettingsFilterStore>(SETTINGS_FILTER) ?? readable({ category: 'all', query: '' });
  setContext(SETTINGS_FIELD, () => title);
  $: visible = matchesSetting($filter, category, `${title} ${tooltip} ${keywords}`);
  $: headingId = settingId ? `setting-${settingId}-heading` : undefined;
</script>

<section
  data-setting={settingId || title}
  data-category={category}
  hidden={!visible}
  class:wide={[
    'appearance',
    'selected-theme',
    'storage-sources',
    'reading-goals',
    'font-defaults'
  ].includes(settingId)}
  class="settings-field rounded-2xl bg-card p-4 text-card-foreground ring-1 ring-border/60 sm:p-5"
  aria-labelledby={showHeading ? headingId : undefined}
>
  <Field.Field>
    {#if showHeading}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} class="text-sm" class:font-semibold={applyHeaderClasses}>{title}</h2>
        <slot name="header" />
      </div>
    {/if}
    {#if tooltip}<Field.Description class="whitespace-pre-line">{tooltip}</Field.Description>{/if}
    <div class="min-w-0"><slot /></div>
  </Field.Field>
</section>

<style>
  .settings-field[hidden] {
    display: none;
  }
  .settings-field {
    min-width: 0;
  }
  .wide {
    grid-column: 1 / -1;
  }
</style>
