/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { OrganizationDialog, MembershipCheckbox } from './apps/web/src/library-react/organization';
      const root = createRoot(document.getElementById('root'));
      let props, strict = false, epoch = 0, shown = true;
      const render = () => flushSync(() => root.render(shown
        ? strict
          ? <React.StrictMode><OrganizationDialog key={epoch} {...props} /></React.StrictMode>
          : <OrganizationDialog key={epoch} {...props} />
        : null));
      window.controls = {
        render: (initial, useStrict) => { props = initial; strict = useStrict; render(); },
        update: changes => { props = { ...props, ...changes }; render(); },
        replace: changes => { props = { ...props, ...changes }; epoch++; shown = true; render(); },
        hide: () => { shown = false; render(); },
        checkbox: props => flushSync(() => root.render(<React.StrictMode><MembershipCheckbox {...props} /></React.StrictMode>)),
        unmount: () => flushSync(() => root.unmount())
      };
    `,
    resolveDir: root,
    loader: 'tsx'
  },
  tsconfig: join(root, 'apps/web/tsconfig.json'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  logLevel: 'warning'
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const book = (key) => ({ key, title: key, organizationKey: key, organizationAliases: [key] });
const collection = (members) => ({ id: 'existing', name: 'Existing collection', members });
const checkbox = (document) => document.querySelector('input[type="checkbox"]');

async function fixture(run) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...parts) => errors.push(parts.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://reader.example/reader-web/manage',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: console
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.eval(outputFiles[0].text);
  const api = window.controls;
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 80 && !predicate(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(predicate(), message);
  };
  const render = (strict, membership, overrides = {}) =>
    api.render(
      {
        mode: 'collections',
        targets: [book('book:one'), book('book:two')],
        collections: [collection(['book:one'])],
        seriesNames: [],
        save: async () => {},
        create: async () => {},
        close: () => {},
        membership,
        ...overrides
      },
      strict
    );
  try {
    await run({ window, api, until, render });
  } finally {
    api.unmount();
    window.close();
  }
  assert.deepEqual(errors, [], 'mounted membership controls must not emit React or DOM errors');
}

for (const strict of [false, true]) {
  const mode = strict ? 'Strict Mode' : 'ordinary mount';
  test(`mixed membership retains the native checked intent until canonical success (${mode})`, async () => {
    await fixture(async ({ window, api, until, render }) => {
      const write = deferred();
      const calls = [];
      render(strict, (id, included) => {
        calls.push([id, included]);
        return write.promise;
      });
      const input = checkbox(window.document);
      assert.equal(input.checked, false);
      assert.equal(input.indeterminate, true);
      input.click();
      // This assertion deliberately runs before awaiting controller notices or persistence.
      // It reproduces Playwright checkbox.check()'s native post-click checked assertion.
      assert.equal(input.checked, true, 'React must not restore the old canonical unchecked value');
      assert.equal(input.indeterminate, false);
      assert.equal(input.disabled, true);
      input.click();
      assert.deepEqual(calls, [['existing', true]], 'a pending checkbox cannot submit twice');
      api.update({
        targets: ['one', 'two'].map((name) => ({
          ...book(`book:${name}`),
          organizationKey: `content:${name}`,
          organizationAliases: [`book:${name}`, `content:${name}`]
        })),
        collections: [collection(['content:one', 'content:two'])]
      });
      assert.equal(
        checkbox(window.document),
        input,
        'content-hash promotion keeps the active control'
      );
      assert.equal(input.checked, true);
      assert.equal(input.disabled, true, 'canonical publication does not finish a pending write');
      write.resolve();
      await until(() => !input.disabled, 'successful write releases the control');
      assert.equal(input.checked, true);
      assert.equal(input.indeterminate, false);
      api.update({ collections: [collection([])] });
      assert.equal(
        input.checked,
        false,
        'settled intent never shadows later canonical store changes'
      );
    });
  });

  test(`failed additions and removals revert to canonical checked and mixed state (${mode})`, async () => {
    await fixture(async ({ window, api, until, render }) => {
      const addition = deferred();
      render(strict, () => addition.promise);
      const input = checkbox(window.document);
      input.click();
      assert.equal(input.checked, true);
      addition.reject(new window.Error('Collection could not be saved.'));
      await until(() => !input.disabled, 'failed addition releases the control');
      assert.equal(input.checked, false);
      assert.equal(input.indeterminate, true);
      assert.equal(
        window.document.querySelector('[role="alert"]').textContent,
        'Collection could not be saved.'
      );
      const removal = deferred();
      api.update({
        collections: [collection(['book:one', 'book:two'])],
        membership: () => removal.promise
      });
      input.click();
      assert.equal(input.checked, false, 'removal intent is retained synchronously too');
      assert.equal(input.disabled, true);
      removal.reject(new window.Error('Removal failed.'));
      await until(() => !input.disabled, 'failed removal releases the control');
      assert.equal(input.checked, true);
      assert.equal(input.indeterminate, false);
      assert.equal(window.document.querySelector('[role="alert"]').textContent, 'Removal failed.');
    });
  });

  test(`scope replacement retires pending intent and prevents stale error or busy updates (${mode})`, async () => {
    await fixture(async ({ window, api, until, render }) => {
      const first = deferred();
      const second = deferred();
      render(strict, () => first.promise);
      checkbox(window.document).click();
      api.update({
        targets: [book('book:replacement')],
        collections: [collection([])],
        membership: () => second.promise
      });
      const replacement = checkbox(window.document);
      assert.equal(replacement.checked, false);
      assert.equal(replacement.indeterminate, false);
      assert.equal(replacement.disabled, false);
      replacement.click();
      assert.equal(replacement.checked, true);
      first.reject(new window.Error('Retired scope failed.'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(replacement.checked, true);
      assert.equal(
        replacement.disabled,
        true,
        'retired operation must not release the new busy guard'
      );
      assert.equal(window.document.querySelector('[role="alert"]'), null);
      api.update({ collections: [collection(['book:replacement'])] });
      second.resolve();
      await until(() => !replacement.disabled, 'replacement operation completes normally');
      assert.equal(replacement.checked, true);
    });
  });

  test(`owner replacement and unmount discard deferred results (${mode})`, async () => {
    await fixture(async ({ window, api, until, render }) => {
      const retired = deferred();
      const active = deferred();
      render(strict, () => retired.promise);
      checkbox(window.document).click();
      // The workspace keys OrganizationDialog by its account/scope organizationEpoch.
      api.replace({ collections: [collection([])], membership: () => active.promise });
      const replacement = checkbox(window.document);
      assert.equal(replacement.checked, false);
      assert.equal(replacement.disabled, false);
      replacement.click();
      retired.reject(new window.Error('Retired owner failed.'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(replacement.checked, true);
      assert.equal(replacement.disabled, true);
      assert.equal(window.document.querySelector('[role="alert"]'), null);
      api.hide();
      active.reject(new window.Error('Unmounted dialog failed.'));
      await until(() => !window.document.querySelector('dialog'), 'dialog unmounts');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  });
}

test('the shared single-book checkbox retires intent when its controller owner changes', async () => {
  await fixture(async ({ window, api, until }) => {
    const first = deferred();
    const second = deferred();
    api.checkbox({ checked: false, disabled: false, scope: {}, onChange: () => first.promise });
    checkbox(window.document).click();
    assert.equal(checkbox(window.document).checked, true);
    api.checkbox({ checked: false, disabled: false, scope: {}, onChange: () => second.promise });
    const current = checkbox(window.document);
    assert.equal(current.checked, false);
    current.click();
    assert.equal(current.checked, true);
    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(current.checked, true);
    assert.equal(current.disabled, true);
    second.reject(new window.Error('Write failed.'));
    await until(() => !current.disabled, 'new owner handles its own failed write');
    assert.equal(current.checked, false);
  });
});
