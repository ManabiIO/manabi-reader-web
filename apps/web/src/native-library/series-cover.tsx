/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { View } from 'react-native';
import { NativeBookCover } from './cover';
import type { NativeLibraryBook } from './contract';
import type { NativeLibraryCover } from './cover-contract';

/** Collapsed series share the web's two-cover silhouette and current viewport admission. */
export function NativeSeriesCover({
  books,
  images,
  grid = false,
  gridWidth = 200
}: {
  books: readonly NativeLibraryBook[];
  images?: ReadonlyMap<string, NativeLibraryCover | null>;
  grid?: boolean;
  gridWidth?: number;
}) {
  const visible = Array.from(new Map(books.map((book) => [book.key, book])).values()).slice(0, 2);
  const width = grid ? Math.max(1, Math.min(200, gridWidth)) : 76;
  return (
    <View
      testID="library-series-cover"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height: width * 1.5,
        flexShrink: 0,
        alignSelf: grid ? 'center' : undefined,
        marginBottom: grid ? 9 : 0
      }}
    >
      {visible.map((book, index) => (
        <View
          key={book.key}
          style={{
            position: 'absolute',
            left: index ? 0 : undefined,
            right: index ? undefined : 0,
            bottom: index ? width * 0.09 : 0,
            zIndex: index ? 1 : 2
          }}
        >
          <NativeBookCover
            grid
            gridWidth={visible.length === 1 ? width : width * 0.9}
            image={images?.get(book.key)}
            title={book.title}
            creators={book.creators}
            blurred={book.coverBlur}
          />
        </View>
      ))}
    </View>
  );
}
