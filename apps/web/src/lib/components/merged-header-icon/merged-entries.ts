/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Bug as faBug } from 'lucide-react';
import { ChartNoAxesCombined as faChartLine } from 'lucide-react';
import { Settings as faCog } from 'lucide-react';
import { FileUp as faFileArrowUp } from 'lucide-react';
import { FileArchive as faFileZipper } from 'lucide-react';
import { FolderPlus as faFolderPlus } from 'lucide-react';
import { Hash as faHashtag } from 'lucide-react';
import { Images as faImages } from 'lucide-react';
import { Library as faSignOutAlt } from 'lucide-react';
import { TriangleAlert as faTriangleExclamation } from 'lucide-react';
import { Cloud as faCloud } from 'lucide-react';

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
