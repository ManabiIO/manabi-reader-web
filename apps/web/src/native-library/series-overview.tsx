/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { View } from 'react-native';
import { UiText as Text } from '../shared-ui/Typography';
import { ActionButton } from '../shared-ui/ActionButton';
import { useUiTheme } from '../shared-ui/theme';
import { NativeBookCover } from './cover';
import type { NativeSeriesOverview, NativeLibraryBook } from './contract';
import type { NativeLibraryCover } from './cover-contract';

/** The selected series is a local shelf, with the DOM owner's canonical reading target. */
export function NativeSeriesHero({
  overview,
  paneWidth,
  disabled,
  images,
  onOpen
}: {
  overview: NativeSeriesOverview;
  paneWidth: number;
  disabled: boolean;
  images?: ReadonlyMap<string, NativeLibraryCover | null>;
  onOpen(book: NativeLibraryBook): void;
}) {
  const { colors } = useUiTheme();
  const artWidth = Math.max(1, Math.min(320, paneWidth - 60));
  const coverWidth = artWidth * 0.46;
  return (
    <View
      testID="library-series-hero"
      style={{
        paddingVertical: 24,
        paddingHorizontal: 12,
        gap: 12,
        alignItems: 'center',
        marginBottom: 24
      }}
    >
      {!!overview.books.length && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: artWidth, height: coverWidth * 1.5, marginBottom: 12 }}
        >
          {overview.books.map((book, index) => (
            <View
              key={book.key}
              style={{
                position: 'absolute',
                left: artWidth * [0.27, 0.11, 0.43, 0, 0.54][index],
                bottom: index ? 8 : 0,
                zIndex: 5 - Math.ceil(index / 2),
                opacity: index ? 0.92 : 1
              }}
            >
              <NativeBookCover
                grid
                gridWidth={index > 2 ? coverWidth * 0.85 : coverWidth}
                image={images?.get(book.key)}
                title={book.title}
                creators={book.creators}
                blurred={book.coverBlur}
              />
            </View>
          ))}
        </View>
      )}
      <Text
        accessibilityRole="header"
        style={{ fontSize: 28, fontWeight: '600', textAlign: 'center' }}
      >
        {overview.title}
      </Text>
      <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>
        Series · {overview.count} {overview.count === 1 ? 'Book' : 'Books'}
        {overview.collection ? ` in ${overview.collection}` : ''}
      </Text>
      {!!overview.creators && (
        <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>
          {overview.creators}
        </Text>
      )}
      {overview.resume ? (
        <ActionButton
          variant="default"
          disabled={disabled}
          accessibilityLabel={`${overview.resumeLabel}: ${overview.resume.title}`}
          onPress={() => onOpen(overview.resume!)}
          style={{ maxWidth: '100%', marginTop: 8, paddingVertical: 12, paddingHorizontal: 20 }}
        >
          <View style={{ flexShrink: 1, gap: 4 }}>
            <Text
              style={{ color: colors.primaryForeground, textAlign: 'center', fontWeight: '600' }}
            >
              {overview.resumeLabel}
            </Text>
            <Text
              numberOfLines={2}
              style={{ color: colors.primaryForeground, textAlign: 'center', fontSize: 13 }}
            >
              {overview.resume.title}
            </Text>
          </View>
        </ActionButton>
      ) : (
        <Text style={{ color: colors.mutedForeground }}>
          {overview.count ? 'All books finished' : 'No books in this view'}
        </Text>
      )}
    </View>
  );
}

/** Header art is admitted only while its measured region intersects the list viewport. */
export function seriesHeaderVisible(headerHeight: number, offset: number, viewportHeight: number) {
  return (
    headerHeight > 0 && viewportHeight > 0 && offset < headerHeight && offset + viewportHeight > 0
  );
}
