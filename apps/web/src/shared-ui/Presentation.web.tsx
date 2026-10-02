/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Only semantic controls need a browser leaf: Expo UI exposes no style prop on Picker/Checkbox. */
export function UiPresentation() {
  return (
    <style href="manabi-shared-controls" precedence="manabi">{`
[data-ui-button]:focus-visible, [data-ui-field] input:focus-visible, [data-ui-field] select:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 2px;
}
[data-ui-heading] { overflow-wrap: normal; word-break: normal; }
[data-ui-button] { transition: color 150ms, background-color 150ms, border-color 150ms; }
[data-ui-button][data-variant='default']:not([aria-disabled='true']):hover { background-color: color-mix(in srgb, var(--primary), var(--primary-foreground) 8%) !important; }
[data-ui-button][data-variant='secondary']:not([aria-disabled='true']):hover { background-color: color-mix(in oklch, var(--secondary), var(--foreground) 5%) !important; }
[data-ui-button][data-variant='secondary'][aria-expanded='true']:not([aria-disabled='true']) { background-color: var(--secondary) !important; }
[data-ui-button][data-variant='link']:hover { text-decoration: underline; }
[data-ui-field] select { width: 100%; min-width: 0; height: auto; min-height: 44px; padding: 8px 36px 8px 10px; border: 1px solid var(--input); border-radius: 10px; background: var(--background); color: var(--foreground); font: inherit; font-size: 1rem; box-shadow: none; }
[data-ui-control='picker'][data-compact='true'] select { border: 0; background: transparent; border-radius: 0; min-height: 32px; padding: 0 20px 0 0; font-size: 1rem; }
[data-ui-control='picker'][data-compact='true'] svg { right: 4px; }
[data-ui-toggle] label { min-height: 44px; width: 100%; }
[data-ui-toggle] label > div:last-child { min-width: 0; overflow-wrap: anywhere; }
/* RNW compiles Expo's hidden-input pointerEvents:none to !important. Match that
   priority so the real input receives hits above its decorative sibling. */
[data-ui-toggle='checkbox'] input { width: 20px; height: 20px; pointer-events: auto !important; z-index: 1; top: 50%; transform: translateY(-50%); scroll-margin-block: 16px; }
[data-ui-toggle='checkbox'] label > div:first-of-type { width: 20px; height: 20px; flex-shrink: 0; }
[data-ui-toggle] label > div { color: var(--foreground); }
[data-ui-toggle='checkbox'] label > div:last-child { font-size: 1rem; }
[data-ui-toggle='switch'] label > div:first-of-type { font-size: 1rem; flex: 1; min-width: 0; }
[data-ui-toggle='switch'] input { width: 36px; height: 22px; pointer-events: auto !important; z-index: 1; right: 0; top: 50%; transform: translateY(-50%); }
[data-ui-modal]::backdrop { background: rgb(0 0 0 / 50%); }
@media (pointer: coarse) { [data-ui-button]:not([data-date]) { min-width: 44px !important; min-height: 44px !important; } }
@media (prefers-reduced-motion: reduce) { [data-ui-button] { transition: none; } }
@media (forced-colors: active) { [data-ui-button]:focus-visible { outline: 2px solid Highlight; } [data-ui-button][aria-pressed='true'] { outline: 2px solid Highlight; outline-offset: -2px; } }
`}</style>
  );
}
