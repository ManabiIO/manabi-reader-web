/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
type SettingsFieldLayout = Pick<
  typeof import('./field-layout'),
  'FieldSurface' | 'FieldHeader' | 'FieldTitle' | 'FieldDescription' | 'FieldContent'
>;

export interface SettingsFieldColors {
  card: string;
  text: string;
  muted: string;
  border: string;
}
export interface SettingsFieldGroupProps {
  layout: SettingsFieldLayout;
  settingId: string;
  category: string;
  title: string;
  headingId?: string;
  description?: string;
  visible?: boolean;
  showHeading?: boolean;
  emphasizeHeading?: boolean;
  wide?: boolean;
  colors?: SettingsFieldColors;
  header?: ReactNode;
  children?: ReactNode;
}

/** Shared Settings field composition. Feature effects and specialized editors stay with their owners. */
export function SettingsFieldGroup({
  layout,
  settingId,
  category,
  title,
  headingId,
  description,
  visible = true,
  showHeading = true,
  emphasizeHeading = true,
  wide = false,
  colors,
  header,
  children
}: SettingsFieldGroupProps) {
  const { FieldSurface, FieldHeader, FieldTitle, FieldDescription, FieldContent } = layout;
  const heading = headingId ?? `settings-field-${settingId}`;
  return (
    <FieldSurface
      settingId={settingId}
      category={category}
      visible={visible}
      labelledBy={showHeading ? heading : undefined}
      wide={wide}
      colors={colors}
    >
      {showHeading ? (
        <FieldHeader>
          <FieldTitle id={heading} emphasized={emphasizeHeading} color={colors?.text}>
            {title}
          </FieldTitle>
          {header}
        </FieldHeader>
      ) : null}
      {description ? (
        <FieldDescription color={colors?.muted}>{description}</FieldDescription>
      ) : null}
      <FieldContent>{children}</FieldContent>
    </FieldSurface>
  );
}
