/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { CalendarHandle, CalendarLayoutProps } from './CalendarLayout';
import { useUiTheme } from './theme';
export type { CalendarHandle, CalendarLayoutProps } from './CalendarLayout';
/** Semantic grid/scroll adapter. Its children, calendar data, actions and styling
 * decisions are supplied by the same shared screen on Android and web. */
export const CalendarLayout = forwardRef<CalendarHandle, CalendarLayoutProps>(
  function CalendarLayout({ children, label, cellSize, columns, onWidth }, ref) {
    const grid = useRef<HTMLDivElement>(null);
    const widthListener = useRef(onWidth);
    widthListener.current = onWidth;
    useEffect(() => {
      const node = grid.current;
      if (!node) return;
      const update = () => widthListener.current(node.clientWidth);
      update();
      const observer =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined;
      observer?.observe(node);
      window.addEventListener('resize', update);
      return () => {
        observer?.disconnect();
        window.removeEventListener('resize', update);
      };
    }, []);
    useImperativeHandle(
      ref,
      () => ({
        movePeriod(direction) {
          const node = grid.current;
          if (!node) return true;
          const boundary =
            direction < 0
              ? node.scrollLeft <= 1
              : node.scrollWidth - node.scrollLeft - 20 <= node.clientWidth;
          if (boundary) return true;
          node.scrollBy({ left: (direction * node.clientWidth) / 2, behavior: 'smooth' });
          return false;
        },
        revealColumn(column) {
          const node = grid.current;
          if (!node) return;
          const left = (column - 1) * (cellSize + 1);
          if (
            left < node.scrollLeft + 2 * (cellSize + 1) ||
            left + cellSize > node.scrollLeft + node.clientWidth
          )
            node.scrollTo({ left: Math.max(0, left - 3 * (cellSize + 1)), behavior: 'auto' });
        }
      }),
      [cellSize]
    );
    return (
      <div
        ref={grid}
        className="heatmap-calendar"
        role="group"
        aria-label={label}
        style={{
          display: 'grid',
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          alignItems: 'center',
          gridAutoColumns: cellSize,
          gridAutoRows: cellSize,
          gap: 1,
          margin: '0 20px',
          padding: '4px 0',
          scrollPaddingInlineStart: cellSize * 2 + 6,
          gridTemplateColumns: `repeat(${columns + 3}, ${cellSize}px)`
        }}
      >
        {children}
      </div>
    );
  }
);
export function calendarCellStyle(row: number, column: number, size: number): StyleProp<ViewStyle> {
  return {
    gridRow: `${row}/${row}`,
    gridColumn: `${column}/${column}`,
    width: size,
    height: size,
    justifySelf: 'center'
  } as ViewStyle;
}
export function calendarLabelStyle(
  row: number,
  column: number,
  size: number
): StyleProp<ViewStyle> {
  return {
    gridRow: `${row}/${row}`,
    gridColumn: `${column}/${column + 2}`,
    height: size,
    ...(column === 1 ? { position: 'sticky', left: 0, zIndex: 2 } : {})
  } as ViewStyle;
}
export function CalendarHeading({ children }: { children: ReactNode }) {
  const { colors } = useUiTheme();
  return (
    <h2
      className="heatmap-toolbar-label"
      style={{
        flex: '1 1 16rem',
        minWidth: 0,
        margin: 0,
        textAlign: 'center',
        textWrap: 'balance',
        fontSize: '1rem',
        lineHeight: 1.5,
        fontWeight: 400,
        color: colors.foreground
      }}
    >
      {children}
    </h2>
  );
}
export function CalendarYear({ children }: { children: ReactNode }) {
  return (
    <span className="heatmap-year" style={{ whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}
export function CalendarControls({ children }: { children: ReactNode }) {
  return (
    <div
      className="heatmap-toolbar-actions"
      style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
    >
      {children}
    </div>
  );
}
