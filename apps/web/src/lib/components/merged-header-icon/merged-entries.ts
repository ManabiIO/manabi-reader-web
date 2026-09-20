/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import faBug from '@lucide/svelte/icons/bug';
import faChartLine from '@lucide/svelte/icons/chart-no-axes-combined';
import faCog from '@lucide/svelte/icons/settings';
import faFileArrowUp from '@lucide/svelte/icons/file-up';
import faFileZipper from '@lucide/svelte/icons/file-archive';
import faFolderPlus from '@lucide/svelte/icons/folder-plus';
import faHashtag from '@lucide/svelte/icons/hash';
import faImages from '@lucide/svelte/icons/images';
import faSignOutAlt from '@lucide/svelte/icons/library';
import faTriangleExclamation from '@lucide/svelte/icons/triangle-alert';
import faCloud from '@lucide/svelte/icons/cloud';

export const mergeEntries = {
  MANAGE: { routeId: '/manage', label: 'Manager', icon: faSignOutAlt, title: 'Go to Book Manager' },
  CONNECTIONS: {
    routeId: '/connections',
    label: 'Accounts and libraries',
    icon: faCloud,
    title: 'Accounts and libraries'
  },
  SETTINGS: {
    routeId: '/settings',
    label: 'Settings',
    icon: faCog,
    title: 'Go to Reader Settings'
  },
  STATISTICS: {
    routeId: '/statistics',
    label: 'Statistics',
    icon: faChartLine,
    title: 'Go to Statistics'
  },
  JUMP_TO_POSITION: { routeId: '', label: 'Jump', icon: faHashtag, title: 'Jump to Position' },
  READER_IMAGE_GALLERY: {
    routeId: '',
    label: 'Images',
    icon: faImages,
    title: 'Open Image Gallery'
  },
  DOMAIN_HINT: {
    routeId: '',
    label: 'Domain Hint',
    icon: faTriangleExclamation,
    title: 'Old Domain used'
  },
  BUG_REPORT: { routeId: '', label: 'Bug Report', icon: faBug, title: 'Report an Issue' },
  FOLDER_IMPORT: {
    routeId: '',
    label: 'Import Folder(s)',
    icon: faFolderPlus,
    title: 'Import from Folder'
  },
  FILE_IMPORT: { routeId: '', label: 'Import File(s)', icon: faFileArrowUp, title: 'Import Files' },
  TTU_IMPORT: {
    routeId: '/import-ttu',
    label: 'Import from Ttu Ebook Reader',
    icon: faFileZipper,
    title: 'Import from Ttu Ebook Reader'
  },
  BACKUP_IMPORT: { routeId: '', label: 'Import Backup', icon: faFileZipper, title: 'Import Backup' }
};
