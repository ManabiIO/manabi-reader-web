/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useContext } from 'react';
import { Host, Icon } from '@expo/ui';
import { ControlTone } from './ControlTone';
import { useUiTheme } from './theme';
import trashAsset from './icons/trash.xml';
import editAsset from './icons/edit.xml';
import saveAsset from './icons/save.xml';
import closeAsset from './icons/close.xml';
import previousAsset from './icons/previous.xml';
import nextAsset from './icons/next.xml';
import downAsset from './icons/down.xml';
import repeatAsset from './icons/repeat.xml';
import layersAsset from './icons/layers.xml';
import sortAscendingAsset from './icons/sortAscending.xml';
import sortDescendingAsset from './icons/sortDescending.xml';
import menuAsset from './icons/menu.xml';
import leftAsset from './icons/left.xml';
import rightAsset from './icons/right.xml';
import moreAsset from './icons/more.xml';
const assets = {
  trash: trashAsset,
  edit: editAsset,
  save: saveAsset,
  close: closeAsset,
  previous: previousAsset,
  next: nextAsset,
  down: downAsset,
  repeat: repeatAsset,
  layers: layersAsset,
  sortAscending: sortAscendingAsset,
  sortDescending: sortDescendingAsset,
  menu: menuAsset,
  left: leftAsset,
  right: rightAsset,
  more: moreAsset
};
export interface UiIconProps {
  name: keyof typeof assets;
  size?: number;
  color?: string;
}
/** Android vector leaf uses the same original icon paths, hosted by Expo UI. */
export function UiIcon({ name, size = 16, color }: UiIconProps) {
  const tone = useContext(ControlTone);
  const theme = useUiTheme();
  return (
    <Host
      matchContents
      colorScheme={theme.mode}
      seedColor={theme.seedColor}
      style={{ width: size, height: size }}
    >
      <Icon name={assets[name]} size={size} color={color ?? tone ?? theme.colors.foreground} />
    </Host>
  );
}
