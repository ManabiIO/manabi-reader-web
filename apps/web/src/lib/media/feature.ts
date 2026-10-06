/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Build-time release boundary; enabled builds need media qualification. */
export const videoLearningEnabled = process.env.EXPO_PUBLIC_ENABLE_VIDEO_LEARNING === 'true';
