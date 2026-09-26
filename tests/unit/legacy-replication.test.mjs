import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyReplicationTypes } from '../../apps/web/src/lib/manabi/legacy-replication.ts';

test('personal reading authority excludes legacy progress and statistics only', () => {
  const all = ['bookmark', 'statistic', 'readingGoal', 'audioBook', 'subtitle'];
  const personal = ['bookmark', 'statistic'];
  assert.deepEqual(legacyReplicationTypes(all, false, personal), all);
  assert.deepEqual(legacyReplicationTypes(all, true, personal), [
    'readingGoal',
    'audioBook',
    'subtitle'
  ]);
  assert.deepEqual(all, ['bookmark', 'statistic', 'readingGoal', 'audioBook', 'subtitle']);
});
