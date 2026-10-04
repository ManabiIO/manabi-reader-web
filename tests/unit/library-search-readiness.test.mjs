import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  jsxAttributeExpressionText,
  jsxAttributeText,
  jsxElements,
  parseTsx
} from './fixtures/jsx-contract.mjs';
const read = (name) =>
  readFileSync(new URL('../../apps/web/src/library-react/' + name, import.meta.url), 'utf8');
const header = read('header.tsx'),
  controller = read('header-controller.ts');
const disabledExpression = (input) =>
  jsxAttributeExpressionText(input, 'disabled')?.replace(/\s+/g, ' ');
test('both active React search inputs reject interaction until hydration and the query owner are ready', () => {
  assert.match(controller, /hydrated = false/);
  assert.match(controller, /start\(\)[\s\S]*this\.hydrated = true/);
  const inputs = jsxElements(parseTsx(header, 'header.tsx'), 'input').filter(
    (input) => jsxAttributeText(input, 'type') === 'search'
  );
  assert.equal(inputs.length, 2);
  for (const input of inputs) {
    const disabled = disabledExpression(input);
    assert.equal(disabled, '!c.hydrated || !c.libraryMenu');
    assert.doesNotMatch(disabled, /\b(?:busy|scanning|loading)\b/);
  }
});

test('search contract inspection accepts JSX quote formatting without accepting altered readiness', () => {
  for (const type of ['"search"', "{'search'}", '{"search"}']) {
    const source = parseTsx(`
      // <input type="search" disabled={false} />
      const view = <input type=${type} disabled={
        !c.hydrated ||
        !c.libraryMenu
      } />;
    `);
    const inputs = jsxElements(source, 'input');
    assert.equal(inputs.length, 1);
    assert.equal(jsxAttributeText(inputs[0], 'type'), 'search');
    assert.equal(disabledExpression(inputs[0]), '!c.hydrated || !c.libraryMenu');
  }
  for (const disabled of [
    'false',
    '!c.hydrated',
    '!c.hydrated || !c.libraryMenu || c.busy',
    '"!c.hydrated || !c.libraryMenu"'
  ]) {
    const source = parseTsx(`<input type="search" disabled={${disabled}} />`);
    const [input] = jsxElements(source, 'input');
    assert.notEqual(disabledExpression(input), '!c.hydrated || !c.libraryMenu');
  }
  const [staticInput] = jsxElements(
    parseTsx('<input type="search" disabled="!c.hydrated || !c.libraryMenu" />'),
    'input'
  );
  assert.equal(disabledExpression(staticInput), undefined);
});
