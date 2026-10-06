/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LibraryBookFaceLayout } from './LibraryBookFace';
/** Preserve the Svelte shelf's exact DOM/CSS and text hierarchy. */
export const bookFaceLayout: LibraryBookFaceLayout = {
  Face: ({ children }) => <>{children}</>,
  Thumbnail: ({ children }) => <div className="book-thumbnail">{children}</div>,
  Copy: ({ children }) => <div className="book-copy">{children}</div>,
  Title: ({ children }) => <h3>{children}</h3>,
  Author: ({ children }) => <p className="book-author">{children}</p>,
  Detail: ({ children }) => <p className="list-detail">{children}</p>,
  Unread: () => (
    <span title="Unread" className="new-badge">
      NEW
    </span>
  ),
  Selected: () => <span className="selection-label">Selected</span>
};
