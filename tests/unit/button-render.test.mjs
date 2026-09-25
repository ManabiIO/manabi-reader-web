/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

// Compile and render the actual components, not a duplicate shape table.
const root = fileURLToPath(new URL('../../', import.meta.url));
const lib = path.join(root, 'apps/web/src/lib');
const { outputFiles } = await build({
  stdin: {
    contents: `
      import Button, { buttonVariants } from './components/ui/button/button.svelte';
      import Close from './components/ui/close-button.svelte';
      import InputGroupButton from './components/ui/input-group/input-group-button.svelte';
      import { render } from 'svelte/server';
      export { buttonVariants };
      export function html(kind, props) {
        return render({ Button, Close, InputGroupButton }[kind], { props }).body;
      }`,
    resolveDir: lib
  },
  alias: { $lib: lib },
  bundle: true,
  platform: 'node',
  format: 'esm',
  conditions: ['svelte'],
  write: false,
  plugins: [
    {
      name: 'svelte-component-contract',
      setup(builder) {
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => ({
          contents: compile(await readFile(filename, 'utf8'), { filename, generate: 'server' }).js
            .code,
          loader: 'js',
          resolveDir: path.dirname(filename)
        }));
      }
    }
  ]
});
const { buttonVariants, html } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);
const classes = (props) => buttonVariants(props).split(/\s+/);

test('only regular and large bordered variants automatically use capsules', () => {
  for (const variant of ['default', 'outline', 'secondary', 'destructive', 'ghost', 'link']) {
    for (const size of ['xs', 'sm', 'default', 'lg', 'icon-xs', 'icon-sm', 'icon', 'icon-lg']) {
      const expected = !['ghost', 'link'].includes(variant) && ['default', 'lg'].includes(size);
      assert.equal(
        classes({ variant, size }).includes('rounded-full'),
        expected,
        `${variant}/${size}`
      );
    }
  }
});

test('explicit rounded, capsule and circle shapes override automatic style decisions', () => {
  assert.ok(
    classes({ variant: 'secondary', size: 'lg', shape: 'rounded' }).includes('rounded-[12px]')
  );
  assert.ok(
    !classes({ variant: 'secondary', size: 'lg', shape: 'rounded' }).includes('rounded-full')
  );
  assert.ok(classes({ variant: 'ghost', size: 'sm', shape: 'capsule' }).includes('rounded-full'));
  const circle = classes({ variant: 'ghost', size: 'icon-lg', shape: 'circle' });
  assert.ok(circle.includes('rounded-full'));
  assert.ok(circle.includes('aspect-square'));
});

test('dismiss controls remain explicitly circular and disabled-aware', () => {
  const markup = html('Close', { disabled: true, 'aria-label': 'Close collections' });
  assert.match(markup, /data-shape="circle"/);
  assert.match(markup, /aria-label="Close collections"/);
  assert.match(markup, /<button[^>]* disabled(?:[\s>]|="")/);
  assert.match(markup, /data-modal-dismiss/);
  assert.match(markup, /bg-secondary/);
  assert.match(markup, /text-muted-foreground/);
});

test('embedded controls forward compact size rather than inheriting regular button height', () => {
  const markup = html('InputGroupButton', { size: 'icon-xs' });
  assert.match(markup, /data-size="icon-xs"/);
  assert.match(markup, /data-shape="rounded"/);
  assert.doesNotMatch(markup, /min-h-10|rounded-full/);
});

test('disabled link buttons cannot retain href or an overridden tab stop', () => {
  const markup = html('Button', { href: '/reader-web/manage', disabled: true, tabindex: 0 });
  assert.match(markup, /<a\s/);
  assert.doesNotMatch(markup, /\shref=/);
  assert.match(markup, /tabindex="-1"/);
  assert.match(markup, /aria-disabled="true"/);
});

test('enabled links preserve already-resolved internal and external destinations', () => {
  for (const href of ['/reader-web/manage', 'https://example.com/guide']) {
    assert.ok(html('Button', { href }).includes(`href="${href}"`));
  }
});

test('labels wrap without a fixed height and reduced motion disables the translate property', () => {
  const result = classes({ size: 'default' });
  assert.ok(result.includes('whitespace-normal'));
  assert.ok(result.includes('min-h-10'));
  assert.ok(!result.includes('h-10'));
  assert.ok(result.includes('motion-safe:active:not-aria-[haspopup]:translate-y-px'));
  assert.ok(!result.includes('active:not-aria-[haspopup]:translate-y-px'));
});
