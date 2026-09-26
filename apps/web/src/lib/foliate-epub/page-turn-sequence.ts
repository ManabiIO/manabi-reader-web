/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PreparedPageTurn } from './paginator.js';
import type { TurnDirection } from './slide-geometry';

/** 30% less time than the previous 220ms settlement (not 30% more velocity). */
export const PAGE_TURN_DURATION = 154;
export const PAGE_TURN_QUIET_TIME = 120;

export interface PageTurnInput {
  repeat?: boolean;
  /** Physical key identity, used only to match release, including custom bindings. */
  key?: string;
}

interface Clock {
  now(): number;
  frame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  timer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(id: ReturnType<typeof setTimeout>): void;
}

interface TurnPort {
  prepare(direction: TurnDirection): Promise<PreparedPageTurn | null>;
  cancel(): void;
  reducedMotion(): boolean;
  error(error: unknown): void;
}

const defaultClock: Clock = {
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  timer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (id) => clearTimeout(id)
};

/**
 * Leading animation / instant middle / trailing animation. Keep one prepared
 * neighbor, never an animation per queued key. During a burst the most recent
 * request stays one uncommitted turn ahead until keyup (or button-input quiet).
 * A later request makes that tail an instant middle turn, without replaying it.
 * Runs preserve intent order at book edges; opposite directions cannot be netted.
 */
export class PageTurnSequence {
  private runs: Array<{ direction: TurnDirection; count: number }> = [];
  private heldKeys = new Set<string>();
  private generation = 0;
  private busy = false;
  private burst = false;
  private quietAt = 0;
  private prepared?: PreparedPageTurn;
  private frame?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private animationStart?: number;

  constructor(private port: TurnPort, private clock: Clock = defaultClock) {}

  get active() {
    return this.busy;
  }

  request(direction: TurnDirection, input: PageTurnInput = {}) {
    if (direction !== 1 && direction !== -1) return;
    if (input.key) this.heldKeys.add(input.key);
    this.burst = this.burst || this.busy || !!input.repeat;
    this.quietAt = this.clock.now() + PAGE_TURN_QUIET_TIME;
    const last = this.runs.at(-1);
    if (last?.direction === direction) last.count += 1;
    else this.runs.push({ direction, count: 1 });
    if (!this.busy) {
      this.busy = true;
      void this.prepareNext();
    } else if (this.prepared) {
      // Finishing an interrupted leading/trailing animation is instantaneous.
      this.commit();
    }
    // If preparation is still loading, its completion observes the newer runs.
  }

  release(key: string) {
    if (!this.heldKeys.delete(key)) return;
    if (!this.heldKeys.size) {
      this.quietAt = this.clock.now();
      this.decide();
    }
  }

  private async prepareNext() {
    const generation = this.generation;
    const run = this.runs[0];
    if (!run) {
      this.finish();
      return;
    }
    const direction = run.direction;
    if (--run.count === 0) this.runs.shift();
    try {
      const prepared = await this.port.prepare(direction);
      if (generation !== this.generation) {
        prepared?.cancel();
        return;
      }
      if (!prepared) {
        // A book edge consumes this intent, not a later opposite-direction one.
        // Remaining identical intents are also no-ops at this same boundary.
        while (this.runs[0]?.direction === direction) this.runs.shift();
        if (this.runs.length) void this.prepareNext();
        else this.finish();
        return;
      }
      this.prepared = prepared;
      this.decide();
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      this.port.error(error);
    }
  }

  private decide() {
    if (!this.prepared) return;
    if (this.runs.length || this.port.reducedMotion()) {
      this.commit();
      return;
    }
    if (this.animationStart !== undefined) return;
    this.clearTimer();
    if (this.burst) {
      // Keyboard repeat has an explicit end. Do not guess its OS cadence.
      // Missing release is handled by the controller's blur/visibility cancel.
      if (this.heldKeys.size) return;
      const remaining = this.quietAt - this.clock.now();
      if (remaining > 0) {
        this.timer = this.clock.timer(() => this.decide(), remaining);
        return;
      }
    }
    const generation = this.generation;
    this.animationStart = this.clock.now();
    const step = (now: number) => {
      if (generation !== this.generation || !this.prepared) return;
      const t = this.port.reducedMotion()
        ? 1
        : Math.min(1, Math.max(0, (now - this.animationStart!) / PAGE_TURN_DURATION));
      try {
        if (!this.prepared.update(1 - (1 - t) ** 3)) {
          this.cancel();
          return;
        }
      } catch (error) {
        this.cancel();
        this.port.error(error);
        return;
      }
      if (t < 1) this.frame = this.clock.frame(step);
      else this.commit();
    };
    this.frame = this.clock.frame(step);
  }

  private commit() {
    const prepared = this.prepared;
    if (!prepared) return;
    const generation = this.generation;
    this.stopAnimation();
    this.prepared = undefined;
    // Promotion may synchronously trigger a layout/navigation cancellation.
    let committed: boolean;
    try {
      committed = prepared.commit();
    } catch (error) {
      this.cancel();
      this.port.error(error);
      return;
    }
    if (generation !== this.generation) return;
    if (!committed) {
      this.cancel();
      return;
    }
    if (this.runs.length) void this.prepareNext();
    else this.finish();
  }

  private clearTimer() {
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  private stopAnimation() {
    if (this.frame !== undefined) this.clock.cancelFrame(this.frame);
    this.frame = undefined;
    this.animationStart = undefined;
    this.clearTimer();
  }

  private finish() {
    this.stopAnimation();
    this.busy = false;
    this.burst = false;
    this.prepared = undefined;
    // Keep physical key ownership across the OS's initial repeat delay.
  }

  cancel() {
    this.generation += 1;
    this.runs = [];
    this.heldKeys.clear();
    this.finish();
    this.port.cancel();
  }
}
