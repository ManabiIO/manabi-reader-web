/// <reference types="wicg-file-system-access" />
/// <reference types="webappsec-credential-management" />

import 'svelte/elements';
declare module 'svelte/elements' {
  interface HTMLAttributes<T> {
    'on:swipe'?: (event: CustomEvent<{ direction: 'top' | 'right' | 'left' | 'bottom' }>) => void;
  }
}
