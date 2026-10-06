/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentType, ReactNode } from 'react';
export interface LibraryMetadataDraft {
  title: string;
  authors: string;
  authorSort: string;
  language: string;
  published: string;
  publisher: string;
  subjects: string;
  description: string;
}
export type MetadataFieldName = keyof LibraryMetadataDraft;
export interface MetadataFieldSpec {
  name: MetadataFieldName;
  label: string;
  limit: number;
  rows?: number;
  required?: boolean;
  placeholder?: string;
}
export const libraryMetadataFields: readonly MetadataFieldSpec[] = [
  { name: 'title', label: 'Title', limit: 1000, required: true },
  { name: 'authors', label: 'Authors (one per line)', limit: 16415, rows: 3 },
  {
    name: 'authorSort',
    label: 'Author sort names (matching lines, optional)',
    limit: 16415,
    rows: 2
  },
  { name: 'language', label: 'Language', limit: 128 },
  { name: 'published', label: 'Published', limit: 128, placeholder: 'For example, 2024-03-01' },
  { name: 'publisher', label: 'Publisher', limit: 512 },
  { name: 'subjects', label: 'Tags (one per line)', limit: 15423, rows: 2 },
  { name: 'description', label: 'Description', limit: 16000, rows: 5 }
];
export interface MetadataFieldProps extends MetadataFieldSpec {
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  labelId: string;
  compact?: boolean;
}
export interface LibraryMetadataLayout {
  Field: ComponentType<MetadataFieldProps>;
  Publication: ComponentType<{ children: ReactNode }>;
}
/** Common editor ordering, labels, limits and publication grouping. The existing
 * visit-local draft and transactional save/cancel owner remain authoritative. */
export function LibraryMetadataFields({
  layout: L,
  value,
  onChange,
  disabled = false,
  labelPrefix
}: {
  layout: LibraryMetadataLayout;
  value: LibraryMetadataDraft;
  onChange(name: MetadataFieldName, value: string): void;
  disabled?: boolean;
  labelPrefix: string;
}) {
  const field = (spec: MetadataFieldSpec, compact = false) => (
    <L.Field
      key={spec.name}
      {...spec}
      compact={compact}
      value={value[spec.name]}
      onChange={(text) => onChange(spec.name, text)}
      disabled={disabled}
      labelId={`${labelPrefix}-${spec.name === 'authorSort' ? 'author-sort' : spec.name}`}
    />
  );
  return (
    <>
      {libraryMetadataFields.slice(0, 3).map((spec) => field(spec))}
      <L.Publication>
        {libraryMetadataFields.slice(3, 5).map((spec) => field(spec, true))}
      </L.Publication>
      {libraryMetadataFields.slice(5).map((spec) => field(spec))}
    </>
  );
}
