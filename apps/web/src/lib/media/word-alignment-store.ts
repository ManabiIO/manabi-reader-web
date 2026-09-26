/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type Scope } from './contracts.js';
import { MediaStore } from './store.js';
import {
  validateWordAlignmentJob,
  type AlignmentBatchResult,
  type WordAlignmentJob
} from './word-alignment.js';

const KIND = 'word-alignment';

/**
 * Device-local durable alignment checkpoints. Account sync is intentionally not
 * wired in this partial stack yet: backend closed-schema admission must land in
 * the companion PR before these records are allowed onto the personal feed.
 */
export class WordAlignmentStore {
  constructor(
    private store: MediaStore,
    private scope: Scope
  ) {}

  get(id: string): Promise<WordAlignmentJob | undefined> {
    return this.store.local<unknown>(this.scope, KIND, id).then((value) =>
      value === undefined ? undefined : validateWordAlignmentJob(value)
    );
  }

  list(): Promise<WordAlignmentJob[]> {
    return this.store
      .listLocal<unknown>(this.scope, KIND)
      .then((values) => values.map(validateWordAlignmentJob));
  }

  put(job: WordAlignmentJob): Promise<void> {
    return this.store.putLocal(
      this.scope,
      KIND,
      job.id,
      validateWordAlignmentJob(job)
    );
  }

  update(
    id: string,
    change: (
      job: WordAlignmentJob | undefined
    ) => WordAlignmentJob | undefined
  ): Promise<WordAlignmentJob | undefined> {
    return this.store.updateLocal<unknown>(this.scope, KIND, id, (old) => {
      const current =
        old === undefined ? undefined : validateWordAlignmentJob(old);
      const next = change(current);
      return next === undefined
        ? undefined
        : validateWordAlignmentJob(next);
    }) as Promise<WordAlignmentJob | undefined>;
  }

  checkpoint(
    id: string,
    result: AlignmentBatchResult
  ): Promise<WordAlignmentJob | undefined> {
    return this.update(id, (job) => {
      if (!job) throw new Error('Missing alignment job');
      if (job.status === 'complete') return job;
      const existing = job.results.find(
        (item) => item.batchId === result.batchId
      );
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(result))
          throw new Error(
            'Alignment batch already has different durable output'
          );
        return job;
      }
      return {
        ...job,
        status: 'running',
        updatedAt: Date.now(),
        completedBatchIds: [
          ...job.completedBatchIds,
          result.batchId
        ],
        results: [...job.results, structuredClone(result)]
      };
    });
  }

  async complete(
    id: string,
    expectedBatchIds: readonly string[]
  ): Promise<WordAlignmentJob> {
    const updated = await this.update(id, (job) => {
      if (!job) throw new Error('Missing alignment job');
      const actual = new Set(job.completedBatchIds);
      if (
        expectedBatchIds.some((batch) => !actual.has(batch)) ||
        actual.size !== expectedBatchIds.length
      )
        throw new Error(
          'Alignment cannot complete with missing or extra batches'
        );
      return {
        ...job,
        status: 'complete',
        updatedAt: Date.now(),
        error: undefined
      };
    });
    if (!updated) throw new Error('Missing alignment job');
    return updated;
  }
}
