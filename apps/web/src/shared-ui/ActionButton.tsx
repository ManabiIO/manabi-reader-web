/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Children, forwardRef, type ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import {
  Platform,
  Pressable,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type View,
  type ViewStyle
} from 'react-native';
import { useUiTheme } from './theme';
import { UiPresentation } from './Presentation';
import { ControlTone } from './ControlTone';
import { useActionRef } from './useActionRef';
export type ActionVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
export type ActionSize =
  | 'default'
  | 'xs'
  | 'sm'
  | 'lg'
  | 'icon'
  | 'icon-xs'
  | 'icon-sm'
  | 'icon-lg';
export type ActionShape = 'auto' | 'rounded' | 'capsule' | 'circle';
export interface ActionButtonProps extends Omit<PressableProps, 'style' | 'children' | 'role'> {
  children: ReactNode;
  variant?: ActionVariant;
  size?: ActionSize;
  shape?: ActionShape;
  selected?: boolean;
  title?: string;
  role?: 'button' | 'menuitem' | 'link';
  dataSet?: Record<string, string>;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  tabIndex?: 0 | -1;
  onKeyDown?: (event: {
    key: string;
    currentTarget?: unknown;
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  }) => void;
  'aria-pressed'?: boolean;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-haspopup'?: boolean | 'menu' | 'dialog' | 'listbox';
}
const sizes = {
  default: [40, 10, 16, 8, 14],
  xs: [28, 6, 10, 4, 12],
  sm: [32, 8, 12, 4, 14],
  lg: [44, 12, 22, 10, 17],
  icon: [40, 10, 0, 0, 16],
  'icon-xs': [28, 6, 0, 0, 12],
  'icon-sm': [32, 8, 0, 0, 16],
  'icon-lg': [44, 12, 0, 0, 20]
} as const;
export const ActionButton = forwardRef<View, ActionButtonProps>(function ActionButton(
  {
    children,
    variant = 'default',
    size = 'default',
    shape = 'auto',
    selected,
    disabled,
    title,
    dataSet,
    style,
    textStyle,
    role = 'button',
    ...props
  },
  ref
) {
  const { colors: c } = useUiTheme();
  const elementRef = useActionRef(ref, title);
  const [baseHeight, radius, px, py, font] = sizes[size];
  const height = Platform.OS === 'web' ? baseHeight : Math.max(44, baseHeight);
  const icon = size.startsWith('icon') || shape === 'circle';
  const active = selected ?? props['aria-pressed'] ?? props['aria-expanded'] ?? false;
  const filled = variant === 'default';
  const foreground = filled
    ? c.primaryForeground
    : variant === 'secondary'
      ? c.secondaryForeground
      : variant === 'outline' || variant === 'link'
        ? c.primary
        : variant === 'destructive'
          ? c.destructive
          : c.foreground;
  const background = filled
    ? c.primary
    : variant === 'secondary'
      ? c.secondary
      : variant === 'destructive'
        ? c.destructiveBackground
        : 'transparent';
  const round =
    shape === 'circle' ||
    shape === 'capsule' ||
    (shape === 'auto' &&
      ['default', 'secondary', 'outline', 'destructive'].includes(variant) &&
      ['default', 'lg'].includes(size));
  return (
    <>
      <UiPresentation />
      <Pressable
        {...props}
        ref={elementRef}
        role={role}
        disabled={disabled}
        {...(Platform.OS === 'web'
          ? { title, dataSet: { uiButton: '', slot: 'button', variant, size, shape, ...dataSet } }
          : {})}
        aria-pressed={props['aria-pressed'] ?? selected}
        accessibilityState={{
          ...props.accessibilityState,
          disabled: disabled ?? undefined,
          ...(selected === undefined ? {} : { selected })
        }}
        style={(state) => {
          const hover = (state as typeof state & { hovered?: boolean }).hovered;
          const emphasized = active || state.pressed || hover;
          return [
            {
              minHeight: height,
              minWidth: icon ? height : 0,
              width: icon ? height : undefined,
              flexShrink: 0,
              maxWidth: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: size === 'default' || size === 'lg' ? 8 : 4,
              paddingHorizontal: icon || variant === 'link' ? 0 : px,
              paddingVertical: icon ? 0 : py,
              borderWidth: variant === 'link' ? 0 : 1,
              borderColor: variant === 'outline' ? c.primary : 'transparent',
              borderRadius: round ? 999 : variant === 'link' ? 0 : radius,
              backgroundColor:
                emphasized && !disabled && variant === 'destructive'
                  ? c.destructiveHover
                  : emphasized && !disabled && ['ghost', 'outline'].includes(variant)
                    ? variant === 'outline'
                      ? c.primary
                      : c.muted
                    : background,
              opacity: disabled ? 0.5 : state.pressed ? 0.8 : 1
            },
            style
          ];
        }}
      >
        {(state) => {
          const color =
            !disabled &&
            variant === 'outline' &&
            (active || state.pressed || (state as typeof state & { hovered?: boolean }).hovered)
              ? c.primaryForeground
              : foreground;
          return (
            <ControlTone.Provider value={color}>
              {Children.map(children, (child) =>
                typeof child === 'string' || typeof child === 'number' ? (
                  <Text
                    style={[
                      {
                        color,
                        fontFamily:
                          Platform.OS === 'web' ? 'var(--font-sans, system-ui)' : undefined,
                        fontSize:
                          Platform.OS === 'web' ? (`${font / 16}rem` as unknown as number) : font,
                        lineHeight:
                          Platform.OS === 'web' ? ('1.4em' as unknown as number) : font * 1.4,
                        textAlign: 'center',
                        flexShrink: 1,
                        fontWeight: '400'
                      },
                      textStyle
                    ]}
                  >
                    {child}
                  </Text>
                ) : (
                  child
                )
              )}
            </ControlTone.Provider>
          );
        }}
      </Pressable>
    </>
  );
});
export interface HeadingProps {
  children: ReactNode;
  level?: 1 | 2 | 3;
  style?: StyleProp<TextStyle>;
  id?: string;
}
export function Heading({ children, level = 2, style, id }: HeadingProps) {
  const { colors } = useUiTheme();
  const font = level === 1 ? 18 : level === 2 ? 20 : 16;
  const lineHeight = level === 3 ? 24 : 28;
  return (
    <Text
      role="heading"
      aria-level={level}
      nativeID={id}
      {...(Platform.OS === 'web' ? { dataSet: { uiHeading: '' } } : {})}
      style={[
        {
          color: colors.foreground,
          fontFamily: Platform.OS === 'web' ? 'var(--font-sans, system-ui)' : undefined,
          fontSize: Platform.OS === 'web' ? (`${font / 16}rem` as unknown as number) : font,
          lineHeight:
            Platform.OS === 'web' ? (`${lineHeight / 16}rem` as unknown as number) : lineHeight,
          fontWeight: '600',
          flexShrink: 1
        },
        style
      ]}
    >
      {children}
    </Text>
  );
}
export interface NavLinkProps extends Omit<ActionButtonProps, 'onPress' | 'role'> {
  href: string;
}
export function NavLink({ href, ...props }: NavLinkProps) {
  return (
    <Link href={href as Href} asChild>
      <ActionButton {...props} role="link" />
    </Link>
  );
}
