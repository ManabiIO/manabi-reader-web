/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const bookKey = (id: number) => `book:${id}`;
export const contentBookKey = (hash: string) => `content:${hash}`;
export const sourceKey = (source: { id: string; owner: string | null; root: string }) =>
  JSON.stringify([source.owner, source.id, source.root]);
export const sourceBookKey = (
  source: { id: string; owner: string | null; root: string },
  fileId: string
) => `source:${JSON.stringify([source.owner, source.id, source.root, fileId])}`;
