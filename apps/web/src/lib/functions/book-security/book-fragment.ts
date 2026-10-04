/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Fragment aliases are inert data, never Window/Document named properties.
 * Resolve only within the admitted book resource, including iframe documents. */
export function bookFragmentElement(root: ParentNode, fragment: string): Element | null {
  if (!fragment || fragment.length > 512) return null;
  return (
    Array.from(root.querySelectorAll('[id], [data-manabi-fragment-id]')).find(
      (element) =>
        element.id === fragment || element.getAttribute('data-manabi-fragment-id') === fragment
    ) ?? null
  );
}
