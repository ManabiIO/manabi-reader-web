import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMediaTime} from '../../.cache/media-test-build/time.js';
for (const [seconds, expected] of [[0,'0:00'],[4.9,'0:04'],[30,'0:30'],[60,'1:00'],[3599.9,'59:59'],[3600,'1:00:00'],[7325,'2:02:05'],[-1,'0:00'],[-Infinity,'—'],[Infinity,'—'],[NaN,'—']])
    test(`media time ${seconds} uses a readable non-negative clock`,()=>assert.equal(formatMediaTime(seconds),expected));
