import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePreferenceReply,
  parseSession,
  providerAuthorization,
  maxManagedStateBytes,
  validInternalPath,
  validJsonMediaType
} from '../../apps/web/src/lib/manabi/auth-contract.ts';

const csrf = 'c'.repeat(64);

test('managed reading state has room for long-term daily history while remaining bounded', () => {
  assert.equal(maxManagedStateBytes, 1024 * 1024);
});

test('session parsing returns a bounded copy of the authenticated identity', () => {
  const source = {
    user: { id: '42', username: 'reader' },
    csrf_token: csrf,
    providers: ['google', 'dropbox'],
    login_url: 'https://attacker.invalid/'
  };
  const parsed = parseSession(source);
  assert.deepEqual(parsed, {
    user: { id: '42', username: 'reader' },
    csrf_token: csrf,
    providers: ['google', 'dropbox']
  });
  source.user.username = 'changed';
  source.providers.push('onedrive');
  assert.equal(parsed.user.username, 'reader');
  assert.deepEqual(parsed.providers, ['google', 'dropbox']);
});

test('session parsing rejects malformed, ambiguous and unbounded account data', () => {
  const valid = { user: null, csrf_token: csrf, providers: [] };
  for (const candidate of [
    null,
    [],
    { ...valid, csrf_token: '' },
    { ...valid, csrf_token: 'x'.repeat(31) },
    { ...valid, csrf_token: 'x'.repeat(63) + ' ' },
    { ...valid, csrf_token: 'x'.repeat(257) },
    { ...valid, providers: ['google', 'google'] },
    { ...valid, providers: ['Google'] },
    { ...valid, providers: Array.from({ length: 17 }, (_, index) => `p${index}`) },
    { ...valid, user: {} },
    { ...valid, user: { id: '', username: 'reader' } },
    { ...valid, user: { id: '42\nadmin', username: 'reader' } },
    { ...valid, user: { id: '42', username: '' } },
    { ...valid, user: { id: 'x'.repeat(129), username: 'reader' } }
  ])
    assert.equal(parseSession(candidate), null);
});

test('preference replies stay bound to one account and schema revision', () => {
  const valid = {
    user_id: '42',
    schema_version: 1,
    revision: 3,
    settings: { theme: 'dark' }
  };
  assert.deepEqual(parsePreferenceReply(valid, '42'), valid);
  for (const candidate of [
    { ...valid, user_id: '7' },
    { ...valid, schema_version: 2 },
    { ...valid, revision: -1 },
    { ...valid, revision: 1.5 },
    { ...valid, settings: null },
    { ...valid, settings: [] }
  ])
    assert.equal(parsePreferenceReply(candidate, '42'), null);
});

test('internal API paths cannot escape or introduce request syntax', () => {
  for (const path of [
    'preferences/',
    'connections/123/files/?root=books&id=chapter%201.epub',
    'oauth/google/connect/'
  ])
    assert.equal(validInternalPath(path), true, path);
  for (const path of [
    '',
    '/preferences/',
    '//attacker.invalid/',
    '../session/',
    'connections/%2e%2e/session/',
    'connections/books%2Fsecret/',
    'connections/books%5Csecret/',
    'connections/#fragment',
    'connections/\nX-Evil: yes'
  ])
    assert.equal(validInternalPath(path), false, path);
});

test('JSON responses require an exact JSON media type', () => {
  for (const type of [
    'application/json',
    'application/json; charset=utf-8',
    'application/problem+json'
  ])
    assert.equal(validJsonMediaType(type), true, type);
  for (const type of [null, '', 'text/plain', 'text/application/json-evil', 'problem+json'])
    assert.equal(validJsonMediaType(type), false, String(type));
});

test('provider redirects match the backend origin allowlist', () => {
  for (const [provider, href] of [
    ['google', 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x'],
    ['onedrive', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x'],
    ['dropbox', 'https://www.dropbox.com/oauth2/authorize?client_id=x']
  ])
    assert.equal(providerAuthorization(href, provider, 'manabi.io')?.href, href);
  assert.equal(
    providerAuthorization('http://127.0.0.1:8123/authorize?client_id=x', 'fake', 'localhost')?.port,
    '8123'
  );
  for (const [provider, href, hostname = 'manabi.io'] of [
    ['google', 'http://accounts.google.com/o/oauth2/auth'],
    ['google', 'https://accounts.google.com:444/o/oauth2/auth'],
    ['google', 'https://accounts.google.com/o/oauth2/auth#token'],
    ['google', 'https://user@accounts.google.com/o/oauth2/auth'],
    ['google', 'https://accounts.google.com.attacker.invalid/o/oauth2/auth'],
    ['dropbox', 'https://accounts.google.com/o/oauth2/auth'],
    ['google', 'http://127.0.0.1:8123/authorize', 'localhost'],
    ['fake', 'http://127.0.0.1:8123/authorize']
  ])
    assert.equal(providerAuthorization(href, provider, hostname), null, href);
});
