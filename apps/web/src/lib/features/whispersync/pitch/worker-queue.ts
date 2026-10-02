export interface EpochRequest {
  epoch: number;
}

/** Serialize model work and skip queued requests superseded by a newer playback epoch. */
export class LatestEpochQueue<T extends EpochRequest> {
  private epoch = -1;
  private tail: Promise<void> = Promise.resolve();

  constructor(private run: (request: T, current: () => boolean) => Promise<void>) {}

  submit(request: T): Promise<void> {
    if (!Number.isSafeInteger(request.epoch) || request.epoch < 0)
      return Promise.reject(new Error('Invalid pitch analysis epoch'));
    if (request.epoch < this.epoch) return Promise.resolve();
    this.epoch = request.epoch;
    const epoch = request.epoch;
    const task = this.tail.then(async () => {
      if (epoch !== this.epoch) return;
      await this.run(request, () => epoch === this.epoch);
    });
    // A failed model call must not poison admission of the next request.
    this.tail = task.catch(() => {});
    return task;
  }
}
