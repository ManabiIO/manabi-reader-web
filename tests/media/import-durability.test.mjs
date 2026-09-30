import test from 'node:test';
import { cases } from './import-durability-cases.mjs';
import { TransactionFactory, RangeDouble } from './transaction-double.mjs';
for (const scenario of cases)
  test(scenario.name, async () => {
    const previous = globalThis.IDBKeyRange;
    globalThis.IDBKeyRange = RangeDouble;
    try {
      await scenario.run(new TransactionFactory());
    } finally {
      if (previous === undefined) delete globalThis.IDBKeyRange;
      else globalThis.IDBKeyRange = previous;
    }
  });
