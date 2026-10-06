/** @license BSD-3-Clause */
declare global {
  interface HTMLElement {
    scrollIntoViewIfNeeded(arg?: boolean): void;
  }
  interface Navigator {
    msMaxTouchPoints: number;
    standalone: boolean | undefined;
  }
}

export {};
