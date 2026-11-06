/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface BrowserStorageStatusState {
  busy: 'checking' | 'requesting' | null;
  protection: 'unknown' | 'protected' | 'unconfirmed' | 'unavailable';
  canRequest: boolean;
  usage: number | null;
  quota: number | null;
  feedback: 'none' | 'granted' | 'not-granted' | 'unavailable' | 'check-failed';
}

export interface BrowserStorageStatusDependencies {
  readProtection: () => Promise<boolean>;
  requestProtection: () => Promise<boolean>;
  estimate: () => Promise<StorageEstimate>;
  capabilities: () => { protection: boolean; request: boolean; estimate: boolean };
}

/** Origin-level browser observations only; this model never stores application data. */
export function createBrowserStorageStatus(deps: BrowserStorageStatusDependencies) {
  let state: Readonly<BrowserStorageStatusState> = Object.freeze({
    busy: 'checking',
    protection: 'unknown',
    canRequest: false,
    usage: null,
    quota: null,
    feedback: 'none'
  });
  let disposed = false;
  let generation = 0;
  let active: Promise<void> | null = null;
  const listeners = new Set<(state: Readonly<BrowserStorageStatusState>) => void>();
  const publish = (patch: Partial<BrowserStorageStatusState>) => {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    for (const listener of [...listeners]) listener(state);
  };
  const capabilities = () => {
    try {
      return deps.capabilities();
    } catch {
      return { protection: false, request: false, estimate: false };
    }
  };
  const current = (token: number) => !disposed && generation === token;
  const readEstimate = async (enabled: boolean, token: number) => {
    if (!enabled) return true;
    try {
      const estimate = await deps.estimate();
      if (current(token))
        publish({
          usage:
            typeof estimate.usage === 'number' &&
            Number.isFinite(estimate.usage) &&
            estimate.usage >= 0
              ? estimate.usage
              : null,
          quota:
            typeof estimate.quota === 'number' &&
            Number.isFinite(estimate.quota) &&
            estimate.quota > 0
              ? estimate.quota
              : null
        });
      return true;
    } catch {
      // A missing estimate says nothing about whether protection was granted.
      if (current(token)) publish({ usage: null, quota: null });
      return false;
    }
  };
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (active) return active;
    const token = ++generation;
    const available = capabilities();
    publish({
      busy: 'checking',
      canRequest: available.request,
      usage: null,
      quota: null,
      feedback: 'none'
    });
    active = (async () => {
      const probe = async () => {
        if (!available.protection) {
          if (current(token)) publish({ protection: 'unavailable', feedback: 'unavailable' });
          return;
        }
        try {
          const protectedOrigin = await deps.readProtection();
          if (current(token))
            publish({ protection: protectedOrigin ? 'protected' : 'unconfirmed' });
        } catch {
          if (current(token)) publish({ protection: 'unknown', feedback: 'check-failed' });
        }
      };
      const [, estimateSucceeded] = await Promise.all([
        probe(),
        readEstimate(available.estimate, token)
      ]);
      if (current(token)) {
        active = null;
        publish({
          busy: null,
          ...(!estimateSucceeded && state.feedback === 'none'
            ? { feedback: 'check-failed' as const }
            : {})
        });
      }
    })();
    return active;
  };
  const requestProtection = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (active && state.busy === 'requesting') return active;
    const token = ++generation;
    const available = capabilities();
    publish({
      busy: 'requesting',
      canRequest: available.request,
      usage: null,
      quota: null,
      feedback: 'none'
    });
    // Invoke the permission boundary in the click's synchronous stack.
    let permission: Promise<boolean>;
    try {
      permission = available.request
        ? deps.requestProtection()
        : Promise.reject(new Error('Unavailable'));
    } catch (error) {
      permission = Promise.reject(error);
    }
    active = (async () => {
      try {
        const granted = await permission;
        if (current(token))
          publish({
            protection: granted ? 'protected' : 'unconfirmed',
            feedback: granted ? 'granted' : 'not-granted'
          });
      } catch {
        if (current(token))
          publish({
            feedback: 'unavailable',
            ...(!available.request ? { protection: 'unavailable' as const } : {})
          });
      }
      if (!current(token)) return;
      await readEstimate(available.estimate, token);
      if (current(token)) {
        active = null;
        publish({ busy: null });
      }
    })();
    return active;
  };
  return {
    subscribe(listener: (state: Readonly<BrowserStorageStatusState>) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => state,
    refresh,
    requestProtection,
    dispose() {
      disposed = true;
      generation++;
      active = null;
      listeners.clear();
    }
  };
}
