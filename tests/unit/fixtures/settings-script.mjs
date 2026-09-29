/** Execute complete production scripts with declared lifecycle/storage doubles, not a Svelte renderer. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = fileURLToPath(new URL('../../../', import.meta.url));

export function settingsScript(file, initial, bindings, expose, mutable) {
  const path = resolve(
    process.env.SETTINGS_PREIMAGE_ROOT ?? root,
    'apps/web/src/lib/components/settings',
    file
  );
  const text = readFileSync(path, 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
  const source = ts.createSourceFile(path + '.ts', text, ts.ScriptTarget.Latest, true);
  const mounts = [];
  const disposals = [];
  const events = [];
  let api;
  let mounted = true;
  let currentFonts = bindings.$userFonts$;
  const userFonts$ = {
    getValue: () => currentFonts,
    next: (value) => {
      currentFonts = value;
      if (mounted && api) api.set.$userFonts$(value);
    }
  };
  const setters = [...mutable];
  if (Object.hasOwn(bindings, '$userFonts$')) setters.push('$userFonts$');
  const deps = {
    onMount: (callback) => mounts.push(callback),
    onDestroy: (callback) => disposals.push(callback),
    tick: async () => {
      api.reactive();
    },
    createEventDispatcher:
      () =>
      (...args) =>
        events.push(args),
    ...bindings,
    userFonts$
  };
  const printer = ts.createPrinter();
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
  const reactive = statements.filter(ts.isLabeledStatement);
  const reactiveNames = reactive
    .map((statement) => {
      const expression =
        ts.isExpressionStatement(statement.statement) && statement.statement.expression;
      return expression && ts.isBinaryExpression(expression) && ts.isIdentifier(expression.left)
        ? expression.left.text
        : null;
    })
    .filter(Boolean);
  // Svelte's assignment to an auto-subscribed store calls the store setter.
  const fontAssignments = (context) => {
    const visit = (node) => {
      if (
        ts.isBinaryExpression(node) &&
        ts.isIdentifier(node.left) &&
        node.left.text === '$userFonts$' &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        return ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier('userFonts$'),
            'next'
          ),
          undefined,
          [ts.visitNode(node.right, visit)]
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  };
  const print = (node) => {
    const result = ts.transform(node, [fontAssignments]);
    const text = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], source);
    result.dispose();
    return text;
  };
  const declared = new Set(
    statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) =>
        statement.declarationList.declarations.map((declaration) =>
          declaration.name.getText(source)
        )
      )
  );
  for (const name of Object.keys(deps)) declared.add(name);
  const code = [
    reactiveNames.some((name) => !declared.has(name))
      ? `let ${reactiveNames.filter((name) => !declared.has(name)).join(', ')};`
      : '',
    ...statements.map(print),
    `return {${expose.map((name) => `${name}: () => ${name}`).join(',')},`,
    `reactive: () => { ${reactive.map(print).join('\n')} },`,
    `set: { ${setters.map((name) => `${name}: value => { ${declared.has(name) ? `${name} = value;` : ''} }`).join(',')} }};`
  ].join('\n');
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  api = new Function('__initial', ...Object.keys(deps), compiled)(initial, ...Object.values(deps));
  assert.ok(api, 'The complete component script must initialize');
  return {
    ...api,
    events,
    fonts: userFonts$,
    async mount() {
      for (const mount of mounts) {
        const result = await mount();
        if (typeof result === 'function') disposals.push(result);
      }
    },
    dispose() {
      mounted = false;
      for (const dispose of disposals.splice(0)) dispose();
    }
  };
}
