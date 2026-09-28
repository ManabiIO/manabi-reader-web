import test from 'node:test';
import { cases } from './audio-proof-queue-cases.mjs';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
for (const scenario of cases)
  test(scenario.name, async () => {
    const old = globalThis.IDBKeyRange;
    globalThis.IDBKeyRange = RangeDouble;
    try {
      await scenario.run(new TransactionFactory());
    } finally {
      if (old === undefined) delete globalThis.IDBKeyRange;
      else globalThis.IDBKeyRange = old;
    }
  });
