/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { pitchPaths, type PitchState } from '../lib/features/whispersync/pitch/model';
import { ReaderController } from './controller';

export interface PitchStripProps {
  state: PitchState;
  available?: boolean;
  onToggle: () => void;
  onRetry: () => void;
  id?: 'audiobook-voice-pitch';
}

export function createPitchStrip(
  props: PitchStripProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let paths: ReturnType<typeof pitchPaths>;
  let subtitle: string;

  let state: PitchState = props.state;
  let available = props.available !== undefined ? props.available : false;
  let onToggle: () => void = props.onToggle;
  let onRetry: () => void = props.onRetry;
  let id = props.id !== undefined ? props.id : 'audiobook-voice-pitch';
  __readerController.effect(
    () => [state],
    () => {
      __readerController.changed((paths = pitchPaths(state.points, state.time)));
    }
  );
  __readerController.effect(
    () => [state, available],
    () => {
      __readerController.changed(
        (subtitle = !state.enabled
          ? available
            ? 'See how the voice rises and falls'
            : 'Choose an audio file to begin'
          : state.status === 'loading'
            ? 'Preparing visualization'
            : state.status === 'error'
              ? 'Visualization unavailable'
              : state.activity === 'playing'
                ? 'Live · last 8 seconds'
                : state.activity === 'buffering'
                  ? 'Waiting for audio'
                  : state.activity === 'ended'
                    ? 'Finished · trace held'
                    : state.points.length
                      ? 'Paused · trace held'
                      : 'Ready when you press Play')
      );
    }
  );

  const api = {
    controller: __readerController,
    get state() {
      return state;
    },
    set state(nextValue: typeof state) {
      if (Object.is(state, nextValue)) return;
      state = nextValue;
      __readerController.invalidate();
    },
    get available() {
      return available;
    },
    set available(nextValue: typeof available) {
      if (Object.is(available, nextValue)) return;
      available = nextValue;
      __readerController.invalidate();
    },
    get onToggle() {
      return onToggle;
    },
    set onToggle(nextValue: typeof onToggle) {
      if (Object.is(onToggle, nextValue)) return;
      onToggle = nextValue;
      __readerController.invalidate();
    },
    get onRetry() {
      return onRetry;
    },
    set onRetry(nextValue: typeof onRetry) {
      if (Object.is(onRetry, nextValue)) return;
      onRetry = nextValue;
      __readerController.invalidate();
    },
    get id() {
      return id;
    },
    set id(nextValue: typeof id) {
      if (Object.is(id, nextValue)) return;
      id = nextValue;
      __readerController.invalidate();
    },
    get paths() {
      return paths;
    },
    set paths(nextValue: typeof paths) {
      if (Object.is(paths, nextValue)) return;
      paths = nextValue;
      __readerController.invalidate();
    },
    get subtitle() {
      return subtitle;
    },
    set subtitle(nextValue: typeof subtitle) {
      if (Object.is(subtitle, nextValue)) return;
      subtitle = nextValue;
      __readerController.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if ('state' in next) api.state = next.state as typeof state;
      if ('available' in next) api.available = next.available as typeof available;
      if ('onToggle' in next) api.onToggle = next.onToggle as typeof onToggle;
      if ('onRetry' in next) api.onRetry = next.onRetry as typeof onRetry;
      if ('id' in next) api.id = next.id as typeof id;
    }
  };
  return api;
}
