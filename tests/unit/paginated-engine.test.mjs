import assert from 'node:assert/strict';
import test from 'node:test';

import { paginatedEngineFor } from '../../apps/web/src/lib/components/book-reader/book-reader-paginated/paginated-engine.ts';

test('only migrated EPUB publications select the Foliate inline paginator', () => {
  assert.equal(paginatedEngineFor(undefined), 'legacy');
  assert.equal(
    paginatedEngineFor({
      version: 1,
      engine: 'foliate-epub-v1',
      parser: 'foliate',
      toc: [],
      pageList: [],
      landmarks: [],
      rendition: {}
    }),
    'foliate-inline'
  );
});
