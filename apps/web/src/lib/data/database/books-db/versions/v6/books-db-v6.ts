/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Completion } from '$lib/library/completion';
import type { DirectionEvidence } from '$lib/library/direction';
import type { BookCreator } from '$lib/library/book-metadata';
import type { PublicationManifest } from '$lib/reader-location';
import type { EpubPublicationDescriptor } from '$lib/functions/file-loaders/epub/epub-publication';
import type { FsHandle, RemoteContext } from '$lib/data/storage/storage-source-manager';

import type { DBSchema } from 'idb';
import type { ReadingGoal } from '$lib/data/reading-goal';
import type { StorageKey } from '$lib/data/storage/storage-types';

interface Subtitle {
  id: string;
  originalStartSeconds: number;
  adjustedStartSeconds?: number;
  startSeconds: number;
  startTime: string;
  originalEndSeconds: number;
  adjustedEndSeconds?: number;
  endSeconds: number;
  endTime: string;
  originalText: string;
  text: string;
  subIndex: number;
}

interface SubtitleData {
  name: string;
  subtitles: Subtitle[];
}

interface BooksDbV6BookData {
  id: number;
  title: string;
  language?: string;
  creators?: BookCreator[];
  pageDirection?: DirectionEvidence;
  /** SHA-256 of the original imported file, independent of title and location. */
  contentHash?: string;
  styleSheet: string;
  elementHtml: string;
  blobs: Record<string, Blob>;
  coverImage?: string | Blob;
  hasThumb: boolean;
  characters: number;
  sections?: Section[];
  publicationManifest?: PublicationManifest;
  /** EPUB-only Foliate-derived package/navigation descriptor for new imports. */
  epubPublication?: EpubPublicationDescriptor;
  lastBookModified: number;
  lastBookOpen: number;
  storageSource?: string;
  htmlBackup?: string;
}

interface BooksDbV6BookmarkData {
  dataId: number;
  scrollX?: number;
  scrollY?: number;
  exploredCharCount?: number;
  progress: number | string | undefined;
  completion?: Completion;
  lastBookmarkModified: number;
}

interface BooksDbV6StorageSource {
  name: string;
  type: StorageKey;
  data: FsHandle | ArrayBuffer | RemoteContext;
  storedInManager: boolean;
  encryptionDisabled: boolean;
  lastSourceModified: number;
}

interface BooksDbV6Statistic {
  title: string;
  dateKey: string;
  charactersRead: number;
  readingTime: number;
  minReadingSpeed: number;
  altMinReadingSpeed: number;
  lastReadingSpeed: number;
  maxReadingSpeed: number;
  lastStatisticModified: number;
  completedBook?: number;
  completedData?: Omit<BooksDbV6Statistic, 'title' | 'lastStatisticModified'>;
}

interface BooksDbV6ReadingGoal extends ReadingGoal {
  goalEndDate: string;
  goalOriginalEndDate: string;
}

interface BooksDbV6LastModified {
  title: string;
  dataType: string;
  lastModifiedValue: number;
}

interface BooksDbV6AudioBook {
  title: string;
  playbackPosition: number;
  lastAudioBookModified: number;
}

interface BooksDbV6SubtitleData {
  title: string;
  subtitleData: SubtitleData;
  lastSubtitleDataModified: number;
}

interface BooksDbV6Handle {
  title: string;
  dataType: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  lastHandleModified: number;
}

export interface Section {
  reference: string;
  charactersWeight: number;
  label?: string;
  startCharacter?: number;
  characters?: number;
  parentChapter?: string;
}

export default interface BooksDbV6 extends DBSchema {
  data: {
    key: number;
    value: BooksDbV6BookData;
    indexes: {
      title: string;
    };
  };
  bookmark: {
    key: number;
    value: BooksDbV6BookmarkData;
    indexes: {
      dataId: number;
    };
  };
  lastItem: {
    key: number;
    value: {
      dataId: number;
    };
  };
  storageSource: {
    key: string;
    value: BooksDbV6StorageSource;
  };
  statistic: {
    key: string[];
    value: BooksDbV6Statistic;
    indexes: {
      dateKey: string;
      completedBook: (string | number | [])[];
    };
  };
  readingGoal: {
    key: string;
    value: BooksDbV6ReadingGoal;
    indexes: {
      goalEndDate: string;
    };
  };
  lastModified: {
    key: string[];
    value: BooksDbV6LastModified;
  };
  audioBook: {
    key: string;
    value: BooksDbV6AudioBook;
  };
  subtitle: {
    key: string;
    value: BooksDbV6SubtitleData;
  };
  handle: {
    key: string[];
    value: BooksDbV6Handle;
  };
}
