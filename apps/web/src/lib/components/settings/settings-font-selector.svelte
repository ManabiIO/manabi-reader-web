<script lang="ts">
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
  import { LocalFont } from '$lib/data/fonts';
  export let availableFonts: LocalFont[] = [LocalFont.NOTOSANSJP];
  export let fontValue: string;
  export let selectedFont: string | undefined = undefined;
  export let label = 'Show available fonts';
</script>

<ActionMenu label="Choose font" title={label}>
  <Menu.Label>Available fonts</Menu.Label>
  <Menu.RadioGroup value={selectedFont ?? fontValue} onValueChange={(value) => (fontValue = value)}>
    {#each availableFonts as font (font)}<Menu.RadioItem value={font}>{font}</Menu.RadioItem>{/each}
  </Menu.RadioGroup>
</ActionMenu>
