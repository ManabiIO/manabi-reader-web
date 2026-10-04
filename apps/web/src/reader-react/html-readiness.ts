/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A committed markup occurrence publishes readiness once, after parent refs
 * and layout are available. Equal markup in a different spine is a new owner. */
export class HtmlReadiness {
  private html: string | undefined;
  private identity: unknown = Symbol('unmounted');
  private generation = 0;
  private frame: number | undefined;
  private disposed = false;
  private schedule: (callback: () => void) => number;
  private cancel: (frame: number) => void;
  private ready: () => void;
  constructor(
    schedule: (callback: () => void) => number,
    cancel: (frame: number) => void,
    ready: () => void
  ) {
    this.schedule = schedule;
    this.cancel = cancel;
    this.ready = ready;
  }
  update(html: string, identity?: unknown) {
    if (this.disposed || (html === this.html && Object.is(identity, this.identity))) return;
    this.html = html;
    this.identity = identity;
    const generation = ++this.generation;
    if (this.frame !== undefined) this.cancel(this.frame);
    this.frame = this.schedule(() => {
      if (this.disposed || this.generation !== generation) return;
      this.frame = undefined;
      this.ready();
    });
  }
  destroy() {
    this.disposed = true;
    this.generation++;
    if (this.frame !== undefined) this.cancel(this.frame);
    this.frame = undefined;
  }
}
