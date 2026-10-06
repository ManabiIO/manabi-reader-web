/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LibraryMetadataLayout } from './LibraryMetadataFields';
export const metadataLayout: LibraryMetadataLayout = {
  Publication: ({ children }) => (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>
  ),
  Field: ({
    label,
    labelId,
    value,
    onChange,
    limit,
    rows,
    required,
    placeholder,
    disabled,
    compact
  }) => (
    <label className={compact ? 'grid min-w-0 gap-2' : 'grid gap-2'}>
      {rows ? <span id={labelId}>{label}</span> : label}
      {rows ? (
        <textarea
          aria-labelledby={labelId}
          rows={rows}
          maxLength={limit}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={disabled}
          className="metadata-input"
        />
      ) : (
        <input
          maxLength={limit}
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={disabled}
          className="metadata-input"
        />
      )}
    </label>
  )
};
