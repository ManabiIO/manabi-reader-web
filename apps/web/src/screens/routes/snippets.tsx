/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { NativeSnippetsScreen } from '../../native-snippets';
import { Screen } from '../../screens/NativeScreens';
import { useReaderRuntime } from '../../platform/RuntimeProvider.native';
export default function SnippetsRoute() {
  const { snapshot, command } = useReaderRuntime();
  const backHandler = useRef<(() => boolean) | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        setEditing(false);
      };
    }, [])
  );
  return (
    <Screen
      title="Snippets"
      hideMenu={editing}
      onBeforeBack={() => backHandler.current?.() ?? false}
    >
      {focused && (
        <NativeSnippetsScreen
          backHandlerRef={backHandler}
          onEditingChange={setEditing}
          identity={`${snapshot.session}:${snapshot.epoch}`}
          revision={snapshot.revision}
          request={command}
          onRead={(id) => {
            router.push({ pathname: '/b', params: { snippet: id } });
          }}
        />
      )}
    </Screen>
  );
}
