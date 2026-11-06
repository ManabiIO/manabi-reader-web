/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  dimensionExtent,
  dimensionLabel,
  dimensionLimits,
  dimensionPercentage,
  dimensionPixels
} from '../../lib/components/settings/dimension-presets';

export interface DimensionEditorOptions {
  value: number;
  vertical: boolean;
  first: boolean;
  width: number;
  height: number;
  disabled: boolean;
}

/** Controlled, storage-free draft. A gesture belongs to the exact viewport,
 * writing axis, saved value and enabled state where it began, including ABA. */
export function createDimensionEditor(initial: DimensionEditorOptions) {
  let options = { ...initial };
  let revision = 0;
  let gesture: { revision: number; percentage: number } | undefined;
  const listeners = new Set<() => void>();
  const extent = () =>
    dimensionExtent(options.vertical, options.first, options.width, options.height);
  const pixels = (percentage: number) => dimensionPixels(percentage, extent(), options.first);
  const describe = () => {
    const percentage =
      gesture?.revision === revision
        ? gesture.percentage
        : dimensionPercentage(options.value, extent(), options.first);
    const currentValue =
      !Number.isFinite(options.value) || options.value < 0
        ? 'Not set'
        : !options.first && options.value === 0
          ? 'Automatic'
          : `${options.value} px${options.first ? ' per side' : ''}`;
    return {
      value: options.value,
      label: dimensionLabel(options.vertical, options.first),
      extent: extent(),
      limits: dimensionLimits(options.first),
      percentage,
      pixels: pixels(percentage),
      currentValue
    };
  };
  let state = describe();
  const publish = () => {
    state = describe();
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    if (gesture) {
      gesture = undefined;
      publish();
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    configure(next: DimensionEditorOptions) {
      if (
        (Object.keys(options) as (keyof DimensionEditorOptions)[]).every((key) =>
          Object.is(options[key], next[key])
        )
      )
        return;
      options = { ...next };
      revision++;
      // Keep the old gesture's admission until it ends. A resize, disable or
      // external preference change cannot turn its next sample into a new edit.
      publish();
    },
    preview(percentage: number) {
      if (options.disabled || pixels(percentage) === null) return;
      gesture ??= { revision, percentage };
      gesture.percentage = percentage;
      publish();
    },
    commit() {
      const admitted = gesture;
      cancel();
      return !options.disabled && admitted?.revision === revision
        ? pixels(admitted.percentage)
        : null;
    },
    cancel,
    choose(percentage: number) {
      cancel();
      return options.disabled ? null : pixels(percentage);
    },
    automatic() {
      cancel();
      return options.disabled || options.first ? null : 0;
    }
  };
}
