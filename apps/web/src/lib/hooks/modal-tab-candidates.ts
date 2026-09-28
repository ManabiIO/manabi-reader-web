/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const candidates = [
  'button',
  'a[href]',
  'area[href]',
  'input',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
  'audio[controls]',
  'video[controls]',
  'details',
  'details > summary:first-of-type'
].join(',');

/** Light-DOM candidates for our portaled modal fallback, not a replacement for
 * Bits UI's focus scope or a shadow-DOM traversal. Native :disabled deliberately
 * handles disabled fieldsets, including their first-legend exception. */
export function modalTabCandidates(container: HTMLElement): HTMLElement[] {
  const view = container.ownerDocument.defaultView;
  if (!view) return [];
  const eligible = [...container.querySelectorAll<HTMLElement>(candidates)].filter((element) => {
    if (
      element.matches(':disabled, input[type="hidden"]') ||
      element.closest('[inert], [hidden], [aria-hidden="true"]') ||
      !element.getClientRects().length ||
      view.getComputedStyle(element).visibility !== 'visible' ||
      tabOrder(element) < 0
    )
      return false;
    if (element.matches('details') && element.querySelector(':scope > summary')) return false;
    if (element.matches('input[type="radio"]')) {
      const radio = element as HTMLInputElement;
      if (radio.name) {
        const root = radio.getRootNode() as Document | ShadowRoot;
        const radios = root.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        const checked = [...radios].find(
          (other) => other.name === radio.name && other.form === radio.form && other.checked
        );
        if (checked && checked !== radio) return false;
      }
    }
    return true;
  });
  // Sort is stable: positive tabindex precedes the zero-order document flow.
  return eligible.sort((a, b) => (tabOrder(a) || Infinity) - (tabOrder(b) || Infinity));
}

function tabOrder(element: HTMLElement): number {
  if (
    element.tabIndex < 0 &&
    !element.hasAttribute('tabindex') &&
    (element.matches('audio[controls], video[controls], details') ||
      (element.isContentEditable && !element.parentElement?.isContentEditable))
  )
    return 0;
  return element.tabIndex;
}
