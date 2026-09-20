/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get, writable } from 'svelte/store';

export interface ManabiUser {
  id: string;
  username: string;
}
export interface ManabiSession {
  user: ManabiUser | null;
  csrf_token: string;
  providers: string[];
  login_url: string;
  signup_url: string;
}
export type AccountStatus = 'loading' | 'available' | 'unavailable' | 'offline';
export const account = writable<{ status: AccountStatus; session: ManabiSession | null }>({
  status: 'loading',
  session: null
});

const ROOT = '/api/reader-web/';
let generation = 0;
let refreshSerial = 0;

export class IntegrationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly retryAfter = 0
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
  too_large: 'This file or reading-data record exceeds the supported size limit.'
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
  account.update((state) => ({
    ...state,
    session: state.session ? { ...state.session, user: null } : null
  }));
}

async function jsonResponse(response: Response): Promise<any> {
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new IntegrationError('invalid_response', response.status);
  }
  const value = await response.text();
  if (value.length > 4 * 1024 * 1024)
    throw new IntegrationError('invalid_response', response.status);
  try {
    return JSON.parse(value);
  } catch {
    throw new IntegrationError('invalid_response', response.status);
  }
}

export async function refreshAccount(): Promise<ManabiSession | null> {
  const serial = ++refreshSerial;
  try {
    const response = await fetch(`${ROOT}session/`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 404 || response.status === 503) {
      if (serial === refreshSerial)
        account.update((state) => ({ ...state, status: 'unavailable' }));
      return null;
    }
    if (!response.ok) throw new IntegrationError('unavailable', response.status);
    const session = (await jsonResponse(response)) as ManabiSession;
    if (
      typeof session.csrf_token !== 'string' ||
      !Array.isArray(session.providers) ||
      !session.providers.every((p) => typeof p === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(p)) ||
      (session.user !== null &&
        (typeof session.user?.id !== 'string' || typeof session.user?.username !== 'string'))
    ) {
      throw new IntegrationError('invalid_response');
    }
    if (serial !== refreshSerial) return null;
    if (currentUser()?.id !== session.user?.id) generation += 1;
    // Auth navigation is fixed locally, never a server-controlled open redirect.
    session.login_url = '/accounts/login/?next=/Reader-Web/connections';
    session.signup_url = '/accounts/signup/?next=/Reader-Web/connections';
    account.set({ status: 'available', session });
    return session;
  } catch {
    if (serial === refreshSerial)
      account.update((state) => ({
        ...state,
        status: navigator.onLine ? 'unavailable' : 'offline'
      }));
    return null;
  }
}

export async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    value?: unknown;
    revision?: string;
    userId?: string;
    binary?: boolean;
  } = {}
): Promise<T> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_/?=&.%:+-]*$/.test(path) ||
    path.includes('..') ||
    path.startsWith('//')
  ) {
    throw new Error('Invalid internal API path');
  }
  const scope = accountScope();
  if (options.userId && options.userId !== scope.userId)
    throw new IntegrationError('account_changed', 409);
  const session = get(account).session!;
  const headers = new Headers({ 'X-Manabi-User': scope.userId });
  const method = options.method ?? 'GET';
  if (method !== 'GET') headers.set('X-CSRFToken', session.csrf_token);
  if (options.value !== undefined) headers.set('Content-Type', 'application/json');
  if (options.revision) headers.set('If-Match', options.revision);
  let response: Response;
  try {
    response = await fetch(ROOT + path, {
      method,
      headers,
      body: options.value === undefined ? undefined : JSON.stringify(options.value),
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
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
    throw new IntegrationError('account_changed', 409);
  }
  if (!response.ok) {
    const body = await jsonResponse(response).catch(() => ({ error: 'unavailable' }));
    // Response headers and the error body can arrive separately. An old account's
    // delayed 401/409 must not clear the newly authenticated account in this tab.
    if (scope.generation !== generation || currentUser()?.id !== scope.userId)
      throw new IntegrationError('account_changed', 409);
    if (response.status === 401 || body.error === 'account_changed') invalidateAccount();
    throw new IntegrationError(
      typeof body.error === 'string' ? body.error : 'unavailable',
      response.status,
      Math.min(3600, Math.max(0, Number(response.headers.get('Retry-After')) || 0))
    );
  }
  if (options.binary) {
    const bytes = await response.arrayBuffer();
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
  const url = new URL(result.authorize_url);
  const httpsProvider =
    url.protocol === 'https:' &&
    ['accounts.google.com', 'login.microsoftonline.com', 'www.dropbox.com'].includes(url.hostname);
  const isolatedLocal =
    ['127.0.0.1', 'localhost'].includes(location.hostname) &&
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1';
  if ((!httpsProvider && !isolatedLocal) || url.username || url.password)
    throw new IntegrationError('invalid_response');
  location.assign(url.href);
}

export async function signOut() {
  await request('logout/', { method: 'POST' });
  invalidateAccount();
  await refreshAccount();
}

export const providerLabels: Record<string, string> = {
  google: 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox'
};
