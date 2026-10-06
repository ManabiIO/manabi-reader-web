/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { router } from 'expo-router';
import { ActionButton } from './ActionButton';
import { UiIcon } from './UiIcon';

export function RouteBack({
  fallback = '/manage',
  onBeforeBack
}: {
  fallback?: string;
  onBeforeBack?: () => boolean;
}) {
  return (
    <ActionButton
      variant="ghost"
      size="icon-lg"
      shape="circle"
      accessibilityLabel="Back"
      onPress={() => {
        if (!onBeforeBack?.()) {
          if (router.canGoBack()) router.back();
          else router.replace(fallback as '/manage');
        }
      }}
    >
      <UiIcon name="left" size={20} />
    </ActionButton>
  );
}
