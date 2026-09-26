/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationResource, ReaderLocator } from '../reader-location';

/** Use the publication-owned identity, never the locator as its own evidence. */
export function resourceForReaderLocator(
  resources: readonly PublicationResource[],
  locator: ReaderLocator
): PublicationResource | undefined {
  const index = locator.resource?.spineIndex;
  if (!Number.isSafeInteger(index) || index < 0 || index >= resources.length) return undefined;
  const resource = resources[index];
  return resource?.spineIndex === index && resource.href === locator.resource.href
    ? resource
    : undefined;
}

export interface ReaderNavigationOwner {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

/** Own an entire reader request, including preparation before renderer.goTo(). */
export class ReaderNavigationCoordinator {
  private current?: AbortController;
  private disposed = false;

  get pending(): boolean {
    return this.current !== undefined;
  }

  cancel(): void {
    // Clear ownership before dispatching synchronous abort listeners.
    const previous = this.current;
    this.current = undefined;
    previous?.abort();
  }

  async run(operation: (owner: ReaderNavigationOwner) => Promise<boolean>): Promise<boolean> {
    if (this.disposed) return false;
    const previous = this.current;
    const controller = new AbortController();
    this.current = controller;
    // Publish the replacement owner before synchronous abort listeners run.
    previous?.abort();
    const owner: ReaderNavigationOwner = {
      signal: controller.signal,
      isCurrent: () => !this.disposed && this.current === controller && !controller.signal.aborted
    };
    if (!owner.isCurrent()) return false;
    try {
      const accepted = await operation(owner);
      return accepted === true && owner.isCurrent();
    } catch (error) {
      if (!owner.isCurrent()) return false;
      throw error;
    } finally {
      // A superseded operation must not release a newer operation's ownership.
      if (this.current === controller) this.current = undefined;
    }
  }

  destroy(): void {
    this.disposed = true;
    this.cancel();
  }
}
