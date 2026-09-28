/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

interface GallerySpoilerState {
  url: string;
  unspoilered: boolean;
  revealedInGallery?: true;
}

/**
 * A reader rebind observes its own still-hidden DOM, not a new user hide action.
 * Preserve explicit gallery intent only within the current image snapshot.
 * The loader replaces that snapshot (and its blob URLs) when the book changes.
 */
export function gallerySpoilerObservation(
  pictures: readonly GallerySpoilerState[],
  url: string,
  observed: boolean
): boolean {
  return observed || pictures.some((picture) => picture.url === url && picture.revealedInGallery === true);
}

/**
 * Publish the reveal immediately and supersede earlier queued observations.
 * Mark its user intent so a later font/content rebind cannot enqueue a hide.
 * Ordinary loader defaults must not be mistaken for an explicit reveal.
 */
export function revealGalleryPicture<T extends GallerySpoilerState>(
  pictures: T[],
  url: string,
  queue: (picture: T) => void
): T[] {
  const picture = pictures.find((candidate) => candidate.url === url);
  if (!picture) return pictures;
  const revealed = { ...picture, unspoilered: true, revealedInGallery: true as const };
  queue(revealed);
  return pictures.map((candidate) =>
    candidate.url === url ? { ...candidate, unspoilered: true, revealedInGallery: true } : candidate
  );
}
