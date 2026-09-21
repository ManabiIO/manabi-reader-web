/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Completion } from '$lib/library/completion';
import type { DirectionEvidence } from '$lib/library/direction';
import type { BookCreator } from '$lib/library/book-metadata';
export interface BookCardProps {
  id: number;
  imagePath: string | Blob;
  title: string;
  creators?: BookCreator[];
  characters: number;
  lastBookModified: number;
  lastBookOpen: number;
  progress: number;
  lastBookmarkModified: number;
  isPlaceholder: boolean;
  completion?: Completion;
  pageDirection?: DirectionEvidence;
}
