/// <reference types="wicg-file-system-access" />
/// <reference types="webappsec-credential-management" />

import 'svelte/elements';
declare module 'svelte/elements' {
  interface HTMLAttributes<T> {
    'on:swipe'?: {
      handler(event: CustomEvent<{ direction: 'top' | 'right' | 'left' | 'bottom' | null }> & { currentTarget: EventTarget & T }): void;
    }['handler'];
  }
}
