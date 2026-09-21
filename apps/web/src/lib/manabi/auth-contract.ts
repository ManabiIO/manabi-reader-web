/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface ManabiUser {
  id: string;
  username: string;
}

export interface ManabiSession {
  user: ManabiUser | null;
  csrf_token: string;
  providers: string[];
}

export interface PreferenceReply {
  user_id: string;
  schema_version: number;
  revision: number;
  settings: Record<string, unknown>;
}

export const maxManagedStateBytes = 1024 * 1024;

const providerHosts = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'www.dropbox.com'
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
    })
  );
}

export function parseSession(value: unknown): ManabiSession | null {
  if (
    !record(value) ||
    typeof value.csrf_token !== 'string' ||
    !/^[A-Za-z0-9]{32,256}$/.test(value.csrf_token)
  )
    return null;
  const providers = value.providers;
  if (
    !Array.isArray(providers) ||
    providers.length > 16 ||
    !providers.every(
      (provider) => typeof provider === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(provider)
    ) ||
    new Set(providers).size !== providers.length
  )
    return null;
  let user: ManabiUser | null = null;
  if (value.user !== null) {
    if (
      !record(value.user) ||
      !boundedText(value.user.id, 128) ||
      !boundedText(value.user.username, 256)
    )
      return null;
    user = { id: value.user.id, username: value.user.username };
  }
  return { user, csrf_token: value.csrf_token, providers: [...providers] };
}

export function parsePreferenceReply(value: unknown, userId: string): PreferenceReply | null {
  if (
    !record(value) ||
    value.user_id !== userId ||
    value.schema_version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !record(value.settings)
  )
    return null;
  return {
    user_id: userId,
    schema_version: 1,
    revision: value.revision as number,
    settings: value.settings
  };
}

export function validInternalPath(path: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9_/?=&.%:+-]*$/.test(path) || path.startsWith('//')) return false;
  try {
    return path
      .split('?', 1)[0]
      .split('/')
      .every((segment) => {
        const decoded = decodeURIComponent(segment);
        return (
          decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\')
        );
      });
  } catch {
    return false;
  }
}

export function validJsonMediaType(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

export function providerAuthorization(value: unknown, applicationHostname: string): URL | null {
  if (!boundedText(value, 16_384)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const production =
    url.protocol === 'https:' &&
    providerHosts.has(url.hostname) &&
    (url.port === '' || url.port === '443');
  const isolatedLocal =
    ['127.0.0.1', 'localhost'].includes(applicationHostname) &&
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.port !== '';
  return (production || isolatedLocal) && !url.username && !url.password && !url.hash ? url : null;
}
