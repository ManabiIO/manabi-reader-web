/** @license BSD-3-Clause */

/** Build-time release boundary. Enabled builds are qualified by the video workflow. */
export const videoLearningEnabled = import.meta.env.VITE_ENABLE_VIDEO_LEARNING === 'true';
