/** @license BSD-3-Clause */

export type LibrarySearchScope = 'everything' | 'books' | 'snippets';

export interface LibrarySearchScopePlan {
  readonly books: boolean;
  readonly snippets: boolean;
  readonly dictionary: boolean;
}

export const librarySearchScopes = [
  { id: 'everything', label: 'Everything' },
  { id: 'books', label: 'Books' },
  { id: 'snippets', label: 'Snippets' }
] as const satisfies readonly { id: LibrarySearchScope; label: string }[];

const plans = {
  everything: { books: true, snippets: true, dictionary: true },
  books: { books: true, snippets: false, dictionary: false },
  snippets: { books: false, snippets: true, dictionary: false }
} as const satisfies Record<LibrarySearchScope, LibrarySearchScopePlan>;

export const librarySearchScopePlan = (scope: LibrarySearchScope): LibrarySearchScopePlan =>
  plans[scope];


export const parseLibrarySearchScope = (value: string | null): LibrarySearchScope =>
  value === 'books' || value === 'snippets' ? value : 'everything';
