export type SearchState<T> = {
  state: 'idle' | 'loading' | 'ready' | 'error';
  value?: T;
  error?: string;
};
export function queryTask<T>(receive: (state: SearchState<T>) => void): {
  start(
    work: (
      signal: AbortSignal,
      publish: (state: SearchState<T>) => void
    ) => void | (() => void) | Promise<void | (() => void)>,
    delay?: number
  ): void;
  stop(): void;
};
