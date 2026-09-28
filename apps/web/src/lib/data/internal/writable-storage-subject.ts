/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { localStorage } from '../window/local-storage';
import { writableSubject } from '$lib/functions/svelte/store';

type Storage = typeof localStorage;

export function writableStorageSubject<T>(
  storage: Storage,
  mapFromString: (s: string) => T,
  mapToString: (t: T) => string,
  normalize?: (value: T, defaultValue: T) => T
) {
  return (key: string, defaultValue: T) => {
    const normalizeValue = (value: T) => {
      const candidate = value ?? defaultValue;
      return normalize ? normalize(candidate, defaultValue) : candidate;
    };
    const initValue = normalizeValue(getStoredOrDefault(storage)(key, defaultValue, mapFromString));
    const subject = writableSubject(initValue);
    const publish = subject.next.bind(subject);
    // Persistence is part of the write, not an RxJS subscriber side effect.
    // RxJS reports subscriber exceptions asynchronously, after next() returns;
    // an importer could otherwise acknowledge a preference that was never saved.
    const next = (updatedValue: T) => {
      const value = normalizeValue(updatedValue);
      storage.setItem(key, mapToString(value));
      publish(value);
    };
    // subjectToSvelteWritable aliases set before this wrapper is installed.
    return Object.assign(subject, { next, set: next });
  };
}

function getStoredOrDefault(storage: Storage) {
  return <T>(key: string, defaultVal: T, mapFn: (s: string) => T) => {
    const stored = storage.getItem(key);
    return stored ? mapFn(stored) : defaultVal;
  };
}
