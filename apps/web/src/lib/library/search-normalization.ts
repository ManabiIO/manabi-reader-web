/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Keep existing library/worker imports stable. The implementation has no media
// runtime dependencies and also compiles in the standalone media test runner.
export {
  foldSearchCase,
  foldSearch,
  compareSearchText,
  searchMatchedField,
  sortSearchText,
  searchMatchRange,
  type SearchTextFields
} from '../media/search-text.ts';
