/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(
  new URL('../../.github/workflows/contribution-license.yml', import.meta.url),
  'utf8'
);
const script = workflow.match(/node <<'NODE'\n([\s\S]*?)\n\s*NODE\s*$/)?.[1];
assert.ok(script, 'The trusted workflow must retain its inline policy script.');
const reader = {
  PR_REPOSITORY: 'ManabiIO/manabi-reader-web',
  PR_REPOSITORY_ID: '1376293400'
};
const owner = { PR_AUTHOR_ID: '71601', PR_AUTHOR_LOGIN: 'aehlke', PR_AUTHOR_TYPE: 'User' };
const external = { PR_AUTHOR_ID: '123', PR_AUTHOR_LOGIN: 'contributor', PR_AUTHOR_TYPE: 'User' };
const acknowledgement =
  'I agree that the copyrightable portions of this contribution that I own are licensed under BSD-3-Clause, and I have the right to grant that license.';

function check(author, overrides = {}) {
  const process = { env: { ...reader, ...author, ...overrides }, exitCode: 0 };
  runInNewContext(script, { process, console: { log() {}, error() {} } });
  return process.exitCode;
}

test('the owner exemption requires the trusted immutable account and repository identities', () => {
  assert.equal(check(owner), 0);
  for (const overrides of [
    { PR_AUTHOR_ID: '123' },
    { PR_AUTHOR_LOGIN: 'someone-else' },
    { PR_AUTHOR_TYPE: 'Bot' },
    { PR_REPOSITORY: 'someone-else/manabi-reader-web' },
    { PR_REPOSITORY_ID: '123' }
  ]) {
    assert.equal(check(owner, overrides), 1);
  }
});

test('external contributors must check the actual acknowledgement regardless of actor or body claims', () => {
  assert.equal(check(external), 1);
  assert.equal(check(external, { GITHUB_ACTOR: 'aehlke' }), 1);
  assert.equal(check(external, { GITHUB_ACTOR: 'github-actions[bot]' }), 1);
  assert.equal(check(external, { PR_BODY: 'Author: aehlke, ID 71601' }), 1);
  assert.equal(check(external, { PR_BODY: `- [ ] ${acknowledgement}` }), 1);
  assert.equal(check(external, { PR_BODY: acknowledgement }), 1);
  assert.equal(check(external, { PR_BODY: '- [x] I agree to something else.' }), 1);
  assert.equal(check(external, { PR_BODY: `- [x] ${acknowledgement}` }), 0);
  assert.equal(check(external, { PR_BODY: `Summary\r\n- [X] ${acknowledgement}\r\n` }), 0);
});

test('existing automation exemptions belong to verified PR authors, not event actors or lookalikes', () => {
  for (const [login, id] of [
    ['dependabot[bot]', '49699333'],
    ['renovate[bot]', '29139614'],
    ['github-actions[bot]', '41898282']
  ]) {
    const author = { PR_AUTHOR_LOGIN: login, PR_AUTHOR_ID: id, PR_AUTHOR_TYPE: 'Bot' };
    assert.equal(check(author), 0);
    assert.equal(check(author, { PR_AUTHOR_ID: '123' }), 1);
    assert.equal(check(author, { PR_AUTHOR_TYPE: 'User' }), 1);
    assert.equal(check(author, { PR_REPOSITORY_ID: '123' }), 1);
  }
  assert.equal(
    check({ PR_AUTHOR_LOGIN: 'arbitrary[bot]', PR_AUTHOR_ID: '123', PR_AUTHOR_TYPE: 'Bot' }),
    1
  );
  assert.equal(check({ PR_AUTHOR_TYPE: 'Bot' }), 1);
  assert.equal(check({}), 1);
});

test('the policy reads trusted PR author metadata without checking out or running submitted code', () => {
  assert.doesNotMatch(workflow, /actions\/checkout|github\.actor|github\.event\.sender/);
  for (const field of ['id', 'login', 'type']) {
    assert.ok(workflow.includes(`github.event.pull_request.user.${field}`));
  }
  assert.match(workflow, /pull_request_target:/);
});
