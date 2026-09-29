/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

type VideoImportMeta = ImportMeta & {
  readonly env: {
    readonly VITE_ENABLE_VIDEO_LEARNING?: string;
  };
};

/** Build-time release boundary. Enabled builds are qualified by the video workflow. */
export const videoLearningEnabled =
  (import.meta as VideoImportMeta).env.VITE_ENABLE_VIDEO_LEARNING === 'true';
