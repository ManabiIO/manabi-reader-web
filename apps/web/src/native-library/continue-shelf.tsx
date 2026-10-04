/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { FlatList, Pressable, View, type ViewToken } from 'react-native';
import { UiText as Text } from '../shared-ui/Typography';
import { ActionButton } from '../shared-ui/ActionButton';
import { UiIcon } from '../shared-ui/UiIcon';
import { useUiTheme } from '../shared-ui/theme';
import { NativeBookCover } from './cover';
import type { NativeLibraryBook } from './contract';
import type { NativeLibraryCover } from './cover-contract';

/** A bounded horizontal shelf shares the Library's admission and thumbnail owner. */
export function NativeContinueShelf({
  books,
  paneWidth,
  fontScale,
  disabled,
  images,
  onOpen,
  onDetails,
  onViewableItemsChanged,
  viewabilityConfig
}: {
  books: NativeLibraryBook[];
  paneWidth: number;
  fontScale: number;
  disabled: boolean;
  images?: ReadonlyMap<string, NativeLibraryCover | null>;
  onOpen(book: NativeLibraryBook): void;
  onDetails(book: NativeLibraryBook): void;
  onViewableItemsChanged(info: { viewableItems: ViewToken[] }): void;
  viewabilityConfig: { itemVisiblePercentThreshold: number; minimumViewTime: number };
}) {
  const { colors } = useUiTheme();
  const cardWidth = Math.max(1, Math.min(304 * Math.max(1, fontScale), paneWidth - 28));
  return (
    <View style={{ marginBottom: 24, gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600' }}>
        Continue
      </Text>
      <FlatList
        horizontal
        accessibilityLabel="Continue reading"
        showsHorizontalScrollIndicator={false}
        data={books}
        keyExtractor={(book) => book.key}
        initialNumToRender={2}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
        renderItem={({ item }) => (
          <View
            style={{
              width: cardWidth,
              flexDirection: 'row',
              alignItems: 'center',
              borderRadius: 16,
              backgroundColor: colors.card,
              overflow: 'hidden'
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Continue ${item.title}`}
              disabled={disabled}
              accessibilityState={{ disabled }}
              onPress={() => onOpen(item)}
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                paddingRight: 0
              }}
            >
              <NativeBookCover
                grid
                gridWidth={48}
                image={images?.get(item.key)}
                title={item.title}
                creators={item.creators}
                blurred={item.coverBlur}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <Text numberOfLines={2} style={{ fontSize: 16, fontWeight: '600' }}>
                  {item.title}
                </Text>
                {!!item.creators && (
                  <Text numberOfLines={2} style={{ fontSize: 13, color: colors.mutedForeground }}>
                    {item.creators}
                  </Text>
                )}
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                  {item.readingLabel}
                </Text>
              </View>
            </Pressable>
            <ActionButton
              variant="ghost"
              size="icon-lg"
              shape="circle"
              accessibilityLabel={`Details: ${item.title} in Continue`}
              disabled={disabled}
              onPress={() => onDetails(item)}
            >
              <UiIcon name="more" size={20} />
            </ActionButton>
          </View>
        )}
      />
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', marginTop: 12 }}>
        Books
      </Text>
    </View>
  );
}
