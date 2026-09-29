/** @license BSD-3-Clause */

export type LibrarySearchScope = 'everything' | 'books' | 'snippets';

export interface LibrarySearchScopePlan {
  books: boolean;
  snippets: boolean;
  dictionary: boolean;
}

export const librarySearchScopes: { id: LibrarySearchScope; label: string }[] = [
  { id: 'everything', label: 'Everything' },
  { id: 'books', label: 'Books' },
  { id: 'snippets', label: 'Snippets' }
];

const plans: Record<LibrarySearchScope, LibrarySearchScopePlan> = {
  everything: { books: true, snippets: true, dictionary: true },
  books: { books: true, snippets: false, dictionary: false },
  snippets: { books: false, snippets: true, dictionary: false }
};

export const librarySearchScopePlan = (scope: LibrarySearchScope): LibrarySearchScopePlan =>
  plans[scope];
