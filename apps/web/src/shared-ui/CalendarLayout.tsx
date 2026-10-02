/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useUiTheme } from './theme';
export interface CalendarHandle {
  movePeriod(direction: -1 | 1): boolean;
  revealColumn(column: number): void;
}
export interface CalendarLayoutProps {
  children: ReactNode;
  label: string;
  cellSize: number;
  columns: number;
  onWidth(width: number): void;
}
export const CalendarLayout = forwardRef<CalendarHandle, CalendarLayoutProps>(
  function CalendarLayout({ children, label, cellSize, columns, onWidth }, ref) {
    const scroll = useRef<ScrollView>(null);
    const metrics = useRef({ width: 0, x: 0 });
    useImperativeHandle(
      ref,
      () => ({
        movePeriod(direction) {
          const { width, x } = metrics.current;
          const max = (columns + 3) * (cellSize + 1) - width;
          if (direction < 0 ? x <= 1 : x >= max - 1) return true;
          scroll.current?.scrollTo({
            x: Math.max(0, Math.min(max, x + (direction * width) / 2)),
            animated: true
          });
          return false;
        },
        revealColumn(column) {
          scroll.current?.scrollTo({
            x: Math.max(0, (column - 4) * (cellSize + 1)),
            animated: false
          });
        }
      }),
      [cellSize, columns]
    );
    return (
      <ScrollView
        horizontal
        ref={scroll}
        accessibilityRole="none"
        accessibilityLabel={label}
        onLayout={(event) => {
          metrics.current.width = event.nativeEvent.layout.width;
          onWidth(event.nativeEvent.layout.width);
        }}
        onScroll={(event) => {
          metrics.current.x = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
        style={{ flex: 1, marginHorizontal: 20 }}
      >
        <View
          style={{
            width: (columns + 3) * (cellSize + 1),
            height: 8 * (cellSize + 1) + 8,
            position: 'relative'
          }}
        >
          {children}
        </View>
      </ScrollView>
    );
  }
);
export function calendarCellStyle(row: number, column: number, size: number): StyleProp<ViewStyle> {
  return {
    position: 'absolute',
    top: (row - 1) * (size + 1) + 4,
    left: (column - 1) * (size + 1),
    width: size,
    height: size
  };
}
export function calendarLabelStyle(
  row: number,
  column: number,
  size: number
): StyleProp<ViewStyle> {
  return {
    position: 'absolute',
    top: (row - 1) * (size + 1) + 4,
    left: (column - 1) * (size + 1),
    width: column === 1 ? size * 2 + 1 : size * 3,
    height: size
  };
}
export function CalendarHeading({ children }: { children: ReactNode }) {
  const { colors } = useUiTheme();
  return (
    <Text
      role="heading"
      aria-level={2}
      style={{
        flexGrow: 1,
        flexBasis: 256,
        minWidth: 0,
        textAlign: 'center',
        color: colors.foreground,
        fontSize: 16
      }}
    >
      {children}
    </Text>
  );
}
export function CalendarYear({ children }: { children: ReactNode }) {
  return <Text>{children}</Text>;
}
export function CalendarControls({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {children}
    </View>
  );
}
