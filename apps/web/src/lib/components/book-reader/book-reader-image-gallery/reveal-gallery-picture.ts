/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Publish an explicit reveal through the same queue as Reader image updates.
 * A delayed hidden-state observation must not overwrite the newer user action.
 * Return a fresh array immediately; the gallery need not wait for the debounce.
 */
export function revealGalleryPicture<T extends { url: string; unspoilered: boolean }>(
  pictures: T[],
  url: string,
  queue: (picture: T) => void
): T[] {
  const picture = pictures.find((candidate) => candidate.url === url);
  if (!picture) return pictures;
  const revealed = { ...picture, unspoilered: true };
  // Even an already visible image can have a pending hide observation.
  queue(revealed);
  return pictures.map((candidate) =>
    candidate.url === url ? { ...candidate, unspoilered: true } : candidate
  );
}
