import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = name => readFileSync(new URL('../../apps/web/src/library-react/'+name,import.meta.url),'utf8');
const header=read('header.tsx'),controller=read('header-controller.ts');
test('both active React search inputs reject interaction until hydration and the query owner are ready', () => {
  assert.match(controller,/hydrated = false/);
  assert.match(controller,/start\(\)[\s\S]*this\.hydrated = true/);
  const inputs=[...header.matchAll(/<input\b[\s\S]*?\/>/g)].map(([input])=>input).filter(input=>input.includes('type={"search"}'));
  assert.equal(inputs.length,2);
  for(const input of inputs){assert.match(input,/disabled=\{!c\.hydrated \|\| !c\.libraryMenu\}/);assert.doesNotMatch(input,/disabled=\{[^}]*\b(?:busy|scanning|loading)\b/);}
});
