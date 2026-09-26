/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDbV8 from '../v8/books-db-v8';

export type ContentStatistic = BooksDbV8['statistic']['value'] & { bookKey: string };

export interface StatisticMigration {
  title: string;
  state: 'assigned' | 'ambiguous' | 'identity-conflict';
  bookKey?: string;
  legacyAssigned?: boolean;
}

export default interface BooksDbV9 extends BooksDbV8 {
  readerStatistic: {
    key: string[];
    value: ContentStatistic;
    indexes: { dateKey: string };
  };
  readerStatisticMigration: { key: string; value: StatisticMigration };
}
