/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Browser persistence is best effort, not a prerequisite for saving/reading.
 * Keep native receivers, tolerate partial APIs and privacy-mode failures, and
 * never manufacture quota information. Permission prompts remain browser-owned.
 * @param {() => Partial<StorageManager>|undefined} readStorage
 */
export function createStorageAccess(readStorage) {
  /** @type {Promise<boolean>|undefined} */
  let pending;
  async function persisted() {
    try {
      const manager = readStorage();
      return (await manager?.persisted?.()) === true;
    } catch {
      return false;
    }
  }
  function persist() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const manager = readStorage();
        if ((await manager?.persisted?.()) === true) return true;
        return (await manager?.persist?.()) === true;
      } catch {
        return false;
      }
    })().finally(() => {
      // A denial is not cached forever: a later explicit request may succeed.
      pending = undefined;
    });
    return pending;
  }
  /** @returns {Promise<StorageEstimate>} */
  async function estimate() {
    try {
      const manager = readStorage();
      const value = await manager?.estimate?.();
      if (
        value &&
        typeof value.usage === 'number' && Number.isFinite(value.usage) && value.usage >= 0 &&
        typeof value.quota === 'number' && Number.isFinite(value.quota) && value.quota > 0
      ) {
        return { usage: value.usage, quota: value.quota };
      }
    } catch {
      // Unavailable is not "100% used", nor proof that local data was lost.
    }
    return {};
  }
  return { persisted, persist, estimate };
}
