<script lang="ts">
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import SettingsCustomThemeInput from '$lib/components/settings/settings-custom-theme-input.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
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
  let nameError = '';
  // Input's bindable ref has a null fallback; passing undefined throws at runtime.
  let themeNameElm: HTMLInputElement | null = null;

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

  function clearNameError() {
    nameError = '';
    themeNameElm?.setCustomValidity('');
  }

  function invalidName(message: string) {
    nameError = message;
    themeNameElm?.setCustomValidity(message);
    themeNameElm?.focus();
  }

  function handleSave() {
    clearNameError();

    themeName = themeName.trim();
    if (!themeName) {
      invalidName('Enter a theme name.');
      return;
    }

    if (availableThemes.has(themeName) || themeName === 'system-theme') {
      invalidName('This name is reserved for a built-in theme.');
      return;
    }

    if (themeName !== selectedTheme && Object.hasOwn($customThemes$, themeName)) {
      invalidName('A theme with this name already exists. Choose another name.');
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
      <select
        aria-label="Copy colors from theme"
        class="min-h-11 rounded-xl border border-input bg-background px-3 sm:col-span-2"
        bind:value={themeToCopy}
      >
        {#each existingThemes as theme (theme.id)}
          <option value={theme.id}>
            {theme.id}
          </option>
        {/each}
      </select>
      <Button variant="outline" class="min-h-11" onclick={handleCopyTheme}>Copy</Button>
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
      <Input
        class="min-h-11 sm:col-span-2"
        type="text"
        placeholder="Theme Name"
        aria-label="Theme name"
        aria-invalid={Boolean(nameError)}
        aria-describedby={nameError ? 'custom-theme-name-error' : undefined}
        oninput={clearNameError}
        bind:value={themeName}
        bind:ref={themeNameElm}
      />
      <div
        data-theme-preview
        aria-hidden="true"
        class="flex min-h-11 items-center justify-center rounded-xl border-2 border-border p-2 text-lg"
        style={themeStyle}
      >
        ぁあ
      </div>
    </div>
    {#if nameError}
      <p id="custom-theme-name-error" role="alert" class="mt-3">{nameError}</p>
    {/if}
  </div>
  <div class="mt-2 flex grow justify-between gap-2" slot="footer">
    <Button variant="ghost" onclick={() => dispatch('close')}>Cancel</Button>
    <Button variant="secondary" onclick={handleSave}>Save</Button>
  </div>
</DialogTemplate>
