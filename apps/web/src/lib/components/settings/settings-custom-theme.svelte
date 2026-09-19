<script lang="ts">
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsCustomThemeInput from '$lib/components/settings/settings-custom-theme-input.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { customThemes$, theme$ } from '$lib/data/store';
  import {
    availableThemes,
    themeForMode,
    customThemeValues,
    type CustomThemeValue,
    type ThemeOption
  } from '$lib/data/theme-option';
  import { createEventDispatcher, onMount } from 'svelte';
  import { resolvedMode$ } from '$lib/appearance/state';

  export let selectedTheme = '';
  export let existingThemes: ToggleOption<string>[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  let themeToCopy = $theme$;
  let customTheme: Record<keyof ThemeOption, CustomThemeValue> = customThemeValues(
    themeForMode(themeToCopy, $resolvedMode$, $customThemes$)
  );
  let themeName = '';
  let themeNameElm: HTMLInputElement;

  $: themeStyle = `color: ${customTheme.fontColor.rgbaExpression}; background-color: ${customTheme.backgroundColor.rgbaExpression}`;

  onMount(() => {
    const existingThemeObject = $customThemes$[selectedTheme];

    if (!existingThemeObject) {
      return;
    }

    customTheme = customThemeValues(existingThemeObject);
    themeName = selectedTheme;
  });

  function handleCopyTheme() {
    copyTheme(themeForMode(themeToCopy, $resolvedMode$, $customThemes$));
  }

  function handleColorValueChange(
    event: CustomEvent<{ attribute: keyof ThemeOption; value: string }>
  ) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];

    customTheme = {
      ...customTheme,
      ...{
        [attribute]: {
          hexExpression: value,
          alphaValue: entry.alphaValue,
          rgbaExpression: hexToRGB(value, entry.alphaValue)
        }
      }
    };
  }

  function handleAlphaValueChange(
    event: CustomEvent<{ attribute: keyof ThemeOption; value: number }>
  ) {
    const { attribute, value } = event.detail;
    const entry = customTheme[attribute];

    customTheme = {
      ...customTheme,
      ...{
        [attribute]: {
          hexExpression: entry.hexExpression,
          alphaValue: value,
          rgbaExpression: hexToRGB(entry.hexExpression, value)
        }
      }
    };
  }

  function handleSave() {
    themeNameElm.setCustomValidity('');

    themeName = themeName.trim();
    if (!themeName) {
      themeNameElm.setCustomValidity('You have to enter a Name!');
      themeNameElm.reportValidity();
      return;
    }

    if (availableThemes.has(themeName) || themeName === 'system-theme') {
      themeNameElm.setCustomValidity('This Name is reserved!');
      themeNameElm.reportValidity();
      return;
    }

    if (themeName !== selectedTheme && Object.hasOwn($customThemes$, themeName)) {
      themeNameElm.setCustomValidity('A theme with this name already exists. Choose another name.');
      themeNameElm.reportValidity();
      return;
    }

    const newTheme: any = {};
    const entries = [...Object.entries(customTheme)];

    for (let index = 0, { length } = entries; index < length; index += 1) {
      const [key, value] = entries[index];

      newTheme[key] = value.rgbaExpression;
    }

    const themes = { ...$customThemes$, [themeName]: newTheme };
    if (selectedTheme && selectedTheme !== themeName) delete themes[selectedTheme];
    $customThemes$ = themes;
    $theme$ = themeName;
    dispatch('close');
  }

  function copyTheme(theme: Record<keyof ThemeOption, string> | undefined) {
    if (!theme) {
      return;
    }

    customTheme = customThemeValues(theme);
  }

  function hexToRGB(h: string, alpha: number) {
    let r = '0';
    let g = '0';
    let b = '0';

    if (h.length === 4) {
      r = `0x${h[1]}${h[1]}`;
      g = `0x${h[2]}${h[2]}`;
      b = `0x${h[3]}${h[3]}`;
    } else if (h.length === 7) {
      r = `0x${h[1]}${h[2]}`;
      g = `0x${h[3]}${h[4]}`;
      b = `0x${h[5]}${h[6]}`;
    }

    return `rgba(${+r},${+g},${+b},${alpha})`;
  }
</script>

<DialogTemplate>
  <div slot="content">
    <div
      class="grid grid-cols-1 gap-2 items-center overflow-auto max-h-[60vh] sm:grid-cols-[auto_auto_5rem] sm:gap-4"
    >
      <select aria-label="Copy colors from theme" class="sm:col-span-2" bind:value={themeToCopy}>
        {#each existingThemes as theme (theme.id)}
          <option value={theme.id}>
            {theme.id}
          </option>
        {/each}
      </select>
      <button class={buttonClasses} on:click={handleCopyTheme}
        >Copy
        <Ripple />
      </button>
      <span class="hidden sm:block">Attribute</span>
      <span class="hidden sm:block">Color</span>
      <span class="hidden sm:block">Alpha</span>
      <SettingsCustomThemeInput
        label="Font"
        attribute="fontColor"
        values={customTheme.fontColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="Background"
        attribute="backgroundColor"
        values={customTheme.backgroundColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="Selected text"
        attribute="selectionFontColor"
        values={customTheme.selectionFontColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="Selection background"
        attribute="selectionBackgroundColor"
        values={customTheme.selectionBackgroundColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="Furigana Partial Hide Font"
        attribute="hintFuriganaFontColor"
        values={customTheme.hintFuriganaFontColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="Furigana Partial/Full Hide Shadow"
        attribute="hintFuriganaShadowColor"
        values={customTheme.hintFuriganaShadowColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <SettingsCustomThemeInput
        label="Footer Font"
        attribute="tooltipTextFontColor"
        values={customTheme.tooltipTextFontColor}
        on:color={handleColorValueChange}
        on:alpha={handleAlphaValueChange}
      />
      <input
        class="sm:col-span-2"
        type="text"
        placeholder="Theme Name"
        aria-label="Theme name"
        bind:value={themeName}
        bind:this={themeNameElm}
      />
      <button
        class="flex justify-center items-center rounded-md border-2 border-line p-2 text-lg"
        style={themeStyle}
      >
        ぁあ
        <Ripple />
      </button>
    </div>
    <div class="flex mt-4"></div>
  </div>
  <div class="mt-2 flex grow justify-between" slot="footer">
    <button class={buttonClasses} on:click={() => dispatch('close')}>
      Cancel
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={handleSave}>
      Save
      <Ripple />
    </button>
  </div>
</DialogTemplate>
