/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isUUID, type Scope } from './contracts.js';
import { MediaStore } from './store.js';
import {
  alignmentJobIdentity,
  validateAlignmentBatchResult,
  validateWordAlignmentJob,
  type AlignmentBatchResult,
  type WordAlignmentJob
} from './word-alignment.js';

const KIND = 'word-alignment';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function key(id: string) {
  if (!isUUID(id)) throw new Error('Invalid alignment job identity');
  return id;
}

function loaded(value: unknown, id: string): WordAlignmentJob {
  const job = validateWordAlignmentJob(value);
  if (job.id !== id) throw new Error('Alignment job does not match its storage key');
  return job;
}

/**
 * Device-local checkpoints only. No runtime scheduling or account-feed authority
 * is implied. Mutations require the revision captured BEFORE asynchronous work;
 * a pause/resume or competing write revokes that approval inside the transaction.
 */
export class WordAlignmentStore {
  constructor(
    private store: MediaStore,
    private scope: Scope
  ) {}

  get(id: string): Promise<WordAlignmentJob | undefined> {
    key(id);
    return this.store
      .local<unknown>(this.scope, KIND, id)
      .then((value) => (value === undefined ? undefined : loaded(value, id)));
  }

  list(): Promise<WordAlignmentJob[]> {
    return this.store
      .listLocal<unknown>(this.scope, KIND)
      .then((values) => values.map(validateWordAlignmentJob));
  }

  /** Create-only, with equivalent normalized retries. Never reset a job. */
  async put(input: WordAlignmentJob): Promise<void> {
    const job = validateWordAlignmentJob(input);
    await this.store.updateLocal<unknown>(this.scope, KIND, key(job.id), (old) => {
      if (old !== undefined) {
        if (!same(loaded(old, job.id), job)) throw new Error('Alignment job already exists');
        return old;
      }
      if (
        job.revision !== 0 ||
        job.status !== 'queued' ||
        job.results.length ||
        job.error !== undefined
      )
        throw new Error('Only a fresh queued alignment job can be created');
      return job;
    });
  }

  private mutate(
    id: string,
    expectedRevision: number,
    change: (job: WordAlignmentJob) => WordAlignmentJob
  ): Promise<WordAlignmentJob> {
    key(id);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error('An exact alignment revision is required');
    return this.store
      .updateLocal<unknown>(this.scope, KIND, id, (old) => {
        if (old === undefined) throw new Error('Missing alignment job');
        const current = loaded(old, id);
        if (current.revision !== expectedRevision)
          throw new Error('Alignment state changed; reload before retrying');
        // A callback must not mutate the copy used to verify immutable inputs.
        const next = validateWordAlignmentJob(change(structuredClone(current)));
        if (alignmentJobIdentity(next) !== alignmentJobIdentity(current))
          throw new Error('Alignment source, model and plan identity cannot change');
        if (next.revision !== current.revision)
          throw new Error('Alignment revisions are owned by the store');
        if (same(next, current)) return old;
        if (current.status === 'complete') throw new Error('Completed alignment is immutable');
        if (current.revision === Number.MAX_SAFE_INTEGER)
          throw new Error('Alignment revision exhausted');
        return validateWordAlignmentJob({
          ...next,
          revision: current.revision + 1,
          updatedAt: Math.max(current.updatedAt, Date.now())
        });
      })
      .then((job) => {
        if (job === undefined) throw new Error('Missing alignment job');
        return loaded(job, id);
      });
  }

  /** State-only edit. Results/inputs cannot be rewritten through this API. */
  update(
    id: string,
    expectedRevision: number,
    change: (job: WordAlignmentJob) => WordAlignmentJob
  ): Promise<WordAlignmentJob> {
    return this.mutate(id, expectedRevision, (current) => {
      const next = validateWordAlignmentJob(change(structuredClone(current)));
      if (
        !same(next.results, current.results) ||
        !same(next.completedBatchIds, current.completedBatchIds)
      )
        throw new Error('Use checkpoint to publish alignment results');
      if (next.status === 'complete' && current.status !== 'complete')
        throw new Error('Use complete to verify the frozen alignment plan');
      const transitions: Record<WordAlignmentJob['status'], string[]> = {
        queued: ['queued', 'running', 'paused'],
        running: ['running', 'paused', 'failed'],
        paused: ['paused', 'queued', 'running'],
        failed: ['failed', 'queued', 'running'],
        complete: ['complete']
      };
      if (!transitions[current.status].includes(next.status))
        throw new Error('Invalid alignment state transition');
      return next;
    });
  }

  checkpoint(
    id: string,
    input: AlignmentBatchResult,
    expectedRevision: number
  ): Promise<WordAlignmentJob> {
    // Snapshot BEFORE waiting on the database, including every returned word.
    const result = validateAlignmentBatchResult(input);
    return this.mutate(id, expectedRevision, (job) => {
      if (job.status !== 'running' && job.status !== 'complete')
        throw new Error('Inactive alignment job cannot accept a checkpoint');
      const existing = job.results.find((item) => item.batchId === result.batchId);
      if (existing) {
        if (!same(existing, result))
          throw new Error('Alignment batch already has different durable output');
        return job;
      }
      if (job.status === 'complete')
        throw new Error('Completed alignment cannot accept a new checkpoint');
      return {
        ...job,
        completedBatchIds: [...job.completedBatchIds, result.batchId],
        results: [...job.results, result]
      };
    });
  }

  /** Completion uses the stored plan, never a caller-supplied subset. */
  complete(id: string, expectedRevision: number): Promise<WordAlignmentJob> {
    return this.mutate(id, expectedRevision, (job) => {
      if (job.status !== 'running' && job.status !== 'complete')
        throw new Error('Inactive alignment job cannot complete');
      if (job.completedBatchIds.length !== job.plannedBatchIds.length)
        throw new Error('Alignment cannot complete with missing batches');
      return { ...job, status: 'complete', error: undefined };
    });
  }
}
