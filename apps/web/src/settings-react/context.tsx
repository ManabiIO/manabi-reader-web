/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { createContext, useContext, useRef } from 'react';
export interface SettingsContextValue {
  getContext<T>(key: unknown): T | undefined;
  setContext<T>(key: unknown, value: T): T;
}
const empty: SettingsContextValue = { getContext: () => undefined, setContext: (_key, value) => value };
export const SettingsContext = createContext<SettingsContextValue>(empty);
/** Context belongs to a React component lifetime, never a module-global render. */
export function useSettingsContext(): SettingsContextValue {
  const parent = useContext(SettingsContext);
  const reference = useRef<SettingsContextValue | null>(null);
  if (!reference.current) {
    const own = new Map<unknown, unknown>();
    reference.current = {
      getContext: <T,>(key: unknown) => own.has(key) ? own.get(key) as T : parent.getContext<T>(key),
      setContext: <T,>(key: unknown, value: T) => { own.set(key, value); return value; }
    };
  }
  return reference.current;
}
