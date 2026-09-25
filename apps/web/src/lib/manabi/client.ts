/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { boundedBytes } from '$lib/library/bounded-response';
import { get, writable } from 'svelte/store';
import {
  parseSession,
  providerAuthorization,
  validInternalPath,
  validJsonMediaType,
  type ManabiSession,
  type ManabiUser
} from './auth-contract';

export type { ManabiSession, ManabiUser } from './auth-contract';
export type AccountStatus = 'loading' | 'available' | 'unavailable' | 'offline';
export const account = writable<{ status: AccountStatus; session: ManabiSession | null }>({
  status: 'loading',
  session: null
});

const ROOT = '/api/reader-web/';
let generation = 0;
let refreshSerial = 0;
let refreshInFlight: { generation: number; promise: Promise<ManabiSession | null> } | undefined;
let lastRefreshFinished = 0;
let lastRefreshResult: ManabiSession | null = null;
let refreshAttempt = 0;

export class IntegrationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly retryAfter = 0,
    public readonly current?: unknown
  ) {
    super(
      messages[code] ?? 'The connection could not complete. Your local reading data is unchanged.'
    );
    this.name = 'IntegrationError';
  }
}
const messages: Record<string, string> = {
  offline: 'You are offline. Reading still works and changes remain on this device.',
  sign_in_required: 'Sign in to Manabi to reconnect your cloud libraries.',
  account_changed: 'The signed-in account changed. Refresh the account before syncing.',
  needs_reconnect: 'This cloud connection needs to be connected again.',
  unauthorized: 'This cloud connection needs to be connected again.',
  forbidden: 'Access to this folder was denied or removed.',
  not_found: 'This connection, folder, or file no longer exists.',
  conflict: 'Both copies changed. Choose which changes to keep before syncing again.',
  rate_limited: 'The service is busy. Retry after the indicated delay.',
  unavailable: 'The service is temporarily unavailable. Local changes have been kept.',
  invalid_response: 'The service returned invalid data. Nothing was overwritten.',
  invalid_cursor: 'The folder listing changed or expired. Refresh the folder.',
  permission_required: 'Reconnect this local folder to grant access again.',
  unsupported: 'This browser does not support persistent local-folder access.',
  request_too_large: 'This reading or settings record exceeds the supported size limit.',
  too_large: 'This file or reading-data record exceeds the supported size limit.',
  plan_limit:
    'You have too many unfinished series operations. Finish or abandon one before starting another.',
  busy: 'This cloud operation is still in progress. Check its status shortly.',
  precondition_required: 'Refresh the operation plan before continuing.',
  ambiguous_statistics:
    'Reading sync is paused because different books share a title in legacy statistics. Local data is kept.'
};

export function currentUser(): ManabiUser | null {
  return get(account).session?.user ?? null;
}

export function accountScope(): { userId: string; generation: number } {
  const user = currentUser();
  if (!user) throw new IntegrationError('sign_in_required', 401);
  return { userId: user.id, generation };
}

function invalidateAccount() {
  refreshSerial += 1;
  generation += 1;
  refreshAttempt += 1;
  lastRefreshFinished = 0;
  lastRefreshResult = null;
  account.update((state) => ({
    ...state,
    session: state.session ? { ...state.session, user: null } : null
  }));
}

async function jsonResponse(response: Response): Promise<any> {
  if (!validJsonMediaType(response.headers.get('Content-Type'))) {
    throw new IntegrationError('invalid_response', response.status);
  }
  try {
    const bytes = await boundedBytes(response, 4 * 1024 * 1024);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new IntegrationError('invalid_response', response.status);
  }
}

async function performAccountRefresh(force: boolean): Promise<ManabiSession | null> {
  const serial = ++refreshSerial;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${ROOT}session/`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      // Ordinary probes may overlap navigation. Let them finish rather than
      // surfacing an unload-time cancellation as a WebKit CORS page error.
      // A forced online/user refresh must consume the body in the live page;
      // Chromium can discard a keepalive response body in that path.
      keepalive: !force,
      signal: controller.signal
    });
    if (response.status === 404 || response.status === 503) {
      if (serial === refreshSerial)
        account.update((state) => ({ ...state, status: 'unavailable' }));
      return null;
    }
    if (!response.ok) throw new IntegrationError('unavailable', response.status);
    const session = parseSession(await jsonResponse(response));
    if (!session) throw new IntegrationError('invalid_response');
    if (response.headers.get('X-Manabi-User') !== (session.user?.id ?? ''))
      throw new IntegrationError('invalid_response');
    if (serial !== refreshSerial) return null;
    if (currentUser()?.id !== session.user?.id) generation += 1;
    account.set({ status: 'available', session });
    return session;
  } catch {
    if (serial === refreshSerial)
      account.update((state) => ({
        ...state,
        status: navigator.onLine ? 'unavailable' : 'offline'
      }));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function refreshAccount(force = false): Promise<ManabiSession | null> {
  const admittedGeneration = generation;
  // A forced probe must observe a new cookie/account even when an older probe
  // is still waiting. The refresh serial prevents that older result from
  // replacing the newer session when it eventually settles.
  if (!force && refreshInFlight?.generation === admittedGeneration) return refreshInFlight.promise;
  if (!force && Date.now() - lastRefreshFinished < 5000) return Promise.resolve(lastRefreshResult);
  const attempt = ++refreshAttempt;
  const promise = performAccountRefresh(force)
    .then((result) => {
      if (attempt === refreshAttempt) {
        lastRefreshResult = result;
        lastRefreshFinished = Date.now();
      }
      return result;
    })
    .finally(() => {
      if (refreshInFlight?.promise === promise) refreshInFlight = undefined;
    });
  refreshInFlight = { generation: admittedGeneration, promise };
  return promise;
}

export async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    value?: unknown;
    revision?: string;
    userId?: string;
    binary?: boolean;
    maximumBytes?: number;
    syncEpoch?: { generation: string; incarnation: string };
  } = {}
): Promise<T> {
  if (!validInternalPath(path)) throw new Error('Invalid internal API path');
  const scope = accountScope();
  if (options.userId && options.userId !== scope.userId)
    throw new IntegrationError('account_changed', 409);
  const session = get(account).session!;
  const headers = new Headers({ 'X-Manabi-User': scope.userId });
  const method = options.method ?? 'GET';
  if (method !== 'GET') headers.set('X-CSRFToken', session.csrf_token);
  if (options.value !== undefined) headers.set('Content-Type', 'application/json');
  if (options.revision) headers.set('If-Match', options.revision);
  if (options.syncEpoch) {
    headers.set('X-Manabi-Sync-Generation', options.syncEpoch.generation);
    headers.set('X-Manabi-Sync-Incarnation', options.syncEpoch.incarnation);
  }
  let response: Response;
  try {
    response = await fetch(ROOT + path, {
      method,
      headers,
      body: options.value === undefined ? undefined : JSON.stringify(options.value),
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      // Library source discovery can still be in flight when a document closes.
      // Keep this small account-scoped GET alive so WebKit does not report its
      // unload cancellation as an uncaught cross-origin fetch error.
      keepalive: method === 'GET' && path === 'connections/',
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    throw new IntegrationError(navigator.onLine ? 'unavailable' : 'offline');
  }
  if (scope.generation !== generation || currentUser()?.id !== scope.userId)
    throw new IntegrationError('account_changed', 409);
  const responseUser = response.headers.get('X-Manabi-User');
  if (response.ok && responseUser !== scope.userId) {
    invalidateAccount();
    // The response may race an in-flight session probe. Start a fresh probe
    // after invalidation so the current cookie always gets the last word.
    void refreshAccount(true);
    throw new IntegrationError('account_changed', 409);
  }
  if (!response.ok) {
    const body = await jsonResponse(response).catch(() => ({ error: 'unavailable' }));
    // Response headers and the error body can arrive separately. An old account's
    // delayed 401/409 must not clear the newly authenticated account in this tab.
    if (scope.generation !== generation || currentUser()?.id !== scope.userId)
      throw new IntegrationError('account_changed', 409);
    if (response.status === 401 || body.error === 'account_changed') {
      invalidateAccount();
      void refreshAccount(true);
    }
    throw new IntegrationError(
      typeof body.error === 'string' ? body.error : 'unavailable',
      response.status,
      Math.min(3600, Math.max(0, Number(response.headers.get('Retry-After')) || 0)),
      body.current
    );
  }
  if (options.binary) {
    const bytes =
      options.maximumBytes === undefined
        ? await response.arrayBuffer()
        : await boundedBytes(response, options.maximumBytes);
    if (bytes.byteLength > 128 * 1024 * 1024) throw new IntegrationError('too_large');
    if (scope.generation !== generation || currentUser()?.id !== scope.userId)
      throw new IntegrationError('account_changed', 409);
    return bytes as T;
  }
  const value = (await jsonResponse(response)) as T;
  if (scope.generation !== generation || currentUser()?.id !== scope.userId)
    throw new IntegrationError('account_changed', 409);
  return value;
}

export async function connectProvider(provider: string) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(provider)) throw new Error('Invalid provider');
  const result = await request<{ authorize_url: string }>(`oauth/${provider}/connect/`, {
    method: 'POST',
    value: {}
  });
  const url = providerAuthorization(result.authorize_url, provider, location.hostname);
  if (!url) throw new IntegrationError('invalid_response');
  location.assign(url.href);
}

/** Starts an incremental OneDrive grant bound to the existing connection. */
export async function requestSeriesWriteAccess(connectionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) throw new Error('Invalid connection ID');
  const result = await request<{ authorize_url: string }>('oauth/onedrive/connect/', {
    method: 'POST',
    value: { purpose: 'series_edit', connection_id: connectionId }
  });
  const url = providerAuthorization(result.authorize_url, 'onedrive', location.hostname);
  if (!url) throw new IntegrationError('invalid_response');
  location.assign(url.href);
}

export async function signOut() {
  await request('logout/', { method: 'POST' });
  invalidateAccount();
  await refreshAccount(true);
}

export const providerLabels: Record<string, string> = {
  google: 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox'
};
