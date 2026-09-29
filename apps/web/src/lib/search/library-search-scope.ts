/** @license BSD-3-Clause */

export type LibrarySearchScope = 'everything' | 'books' | 'snippets';

export const librarySearchScopes: { id: LibrarySearchScope; label: string }[] = [
  { id: 'everything', label: 'Everything' },
  { id: 'books', label: 'Books' },
  { id: 'snippets', label: 'Snippets' }
];

export const scopeIncludesBooks = (scope: LibrarySearchScope) => scope !== 'snippets';
export const scopeIncludesSnippets = (scope: LibrarySearchScope) => scope !== 'books';
export const scopeIncludesDictionary = (scope: LibrarySearchScope) => scope === 'everything';
