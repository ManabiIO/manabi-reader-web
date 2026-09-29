import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const path = fileURLToPath(
  new URL('../../apps/web/src/lib/components/storage-unlock.svelte', import.meta.url)
);
const component = readFileSync(path, 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
const source = ts.createSourceFile(path + '.ts', component, ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter();

function harness(overrides = {}) {
  const received = [];
  const initial = {
    description: 'Protected source',
    action: 'Enter the password to continue',
    requiresSecret: true,
    showCancel: false,
    forwardSecret: false,
    encryptedData: new ArrayBuffer(8),
    resolver: (value) => received.push(value),
    ...overrides.props
  };
  const mounts = [];
  const destroys = [];
  const events = [];
  const skip = [];
  let decryptCalls = 0;
  const decrypt =
    overrides.decrypt ??
    (async () =>
      new TextEncoder().encode(JSON.stringify({ clientId: 'client', clientSecret: '' })));
  const deps = {
    decrypt: async (...args) => {
      decryptCalls += 1;
      return decrypt(...args);
    },
    skipKeyDownListener$: { next: (value) => skip.push(value) },
    onMount: (callback) => mounts.push(callback),
    onDestroy: (callback) => destroys.push(callback),
    createEventDispatcher:
      () =>
      (...args) =>
        events.push(args),
    window: {}
  };

  const statements = source.statements
    .filter((statement) => !ts.isImportDeclaration(statement))
    .map((statement) => {
      if (!ts.isVariableStatement(statement)) return statement;
      const declarations = statement.declarationList.declarations.map((declaration) => {
        if (!ts.isIdentifier(declaration.name) || !Object.hasOwn(initial, declaration.name.text))
          return declaration;
        return ts.factory.updateVariableDeclaration(
          declaration,
          declaration.name,
          declaration.exclamationToken,
          declaration.type,
          ts.factory.createElementAccessExpression(
            ts.factory.createIdentifier('__initial'),
            ts.factory.createStringLiteral(declaration.name.text)
          )
        );
      });
      return ts.factory.updateVariableStatement(
        statement,
        statement.modifiers?.filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword),
        ts.factory.updateVariableDeclarationList(statement.declarationList, declarations)
      );
    });
  const code = [
    ...statements.map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, source)),
    `return {
      unlock,
      closeDialog,
      setSecret: value => { secret = value; },
      getError: () => error,
      getPending: () => pending
    };`
  ].join('\n');
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const api = new Function('__initial', ...Object.keys(deps), compiled)(
    initial,
    ...Object.values(deps)
  );
  return {
    ...api,
    events,
    received,
    skip,
    decryptCalls: () => decryptCalls,
    async mount() {
      for (const mount of mounts) {
        const cleanup = await mount();
        if (typeof cleanup === 'function') destroys.push(cleanup);
      }
    },
    dispose() {
      for (const destroy of destroys.splice(0)) destroy();
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('successful encrypted unlock resolves and closes exactly once', async () => {
  const h = harness({ props: { forwardSecret: true } });
  h.setSecret('fixture password');
  await h.unlock();
  h.closeDialog();
  h.dispose();
  assert.deepEqual(h.received, [
    { clientId: 'client', clientSecret: '', secret: 'fixture password' }
  ]);
  assert.deepEqual(h.events, [['close']]);
  assert.equal(h.decryptCalls(), 1);
});

test('unlock without a secret requirement publishes the continuation sentinel once', async () => {
  const h = harness({
    props: { requiresSecret: false, encryptedData: undefined }
  });
  await h.unlock();
  h.dispose();
  assert.deepEqual(h.received, [{ clientId: '', clientSecret: '' }]);
  assert.deepEqual(h.events, [['close']]);
  assert.equal(h.decryptCalls(), 0);
});

test('decrypt failure remains open and a retry can succeed', async () => {
  let attempt = 0;
  const h = harness({
    decrypt: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Wrong password');
      return new TextEncoder().encode(JSON.stringify({ clientId: 'retry', clientSecret: '' }));
    }
  });
  h.setSecret('wrong');
  await h.unlock();
  assert.deepEqual(h.received, []);
  assert.match(h.getError(), /Wrong password/);
  assert.equal(h.getPending(), false);
  h.setSecret('correct');
  await h.unlock();
  assert.deepEqual(h.received, [{ clientId: 'retry', clientSecret: '' }]);
  assert.equal(h.decryptCalls(), 2);
});

test('repeated submit cannot start a second decrypt while the first is pending', async () => {
  const gate = deferred();
  const h = harness({
    decrypt: async () => {
      await gate.promise;
      return new TextEncoder().encode(JSON.stringify({ clientId: 'one', clientSecret: '' }));
    }
  });
  const first = h.unlock();
  const second = h.unlock();
  assert.equal(h.getPending(), true);
  assert.equal(h.decryptCalls(), 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(h.received, [{ clientId: 'one', clientSecret: '' }]);
  assert.equal(h.decryptCalls(), 1);
});

test('destroying an unresolved unlock cancels once without dispatching a late close', () => {
  const h = harness();
  h.dispose();
  h.dispose();
  assert.deepEqual(h.received, [undefined]);
  assert.deepEqual(h.events, []);
});

test('mount and disposal preserve reader shortcut suppression lifetime', async () => {
  const h = harness();
  await h.mount();
  assert.deepEqual(h.skip, [true]);
  h.dispose();
  assert.deepEqual(h.skip, [true, false]);
});
