/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const settingCategories = [
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, light and dark mode, and background images'
  },
  {
    id: 'typography',
    label: 'Fonts & text',
    description: 'Typography, spacing, and Japanese font options'
  },
  {
    id: 'layout',
    label: 'Page layout',
    description: 'Writing direction, pagination, and margins'
  },
  {
    id: 'reading',
    label: 'Reading controls',
    description: 'Bookmarks, navigation, furigana, and images'
  },
  {
    id: 'library',
    label: 'Library & sync',
    description: 'Storage sources, import, export, and backups'
  },
  {
    id: 'tracking',
    label: 'Tracking & goals',
    description: 'Reading statistics, session behavior, and goals'
  },
  {
    id: 'all',
    label: 'All settings',
    description: 'Every available setting, grouped in one place'
  }
] as const;
