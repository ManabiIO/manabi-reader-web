/** @license BSD-3-Clause */
import { router } from 'expo-router';
import { NativeSnippetsScreen } from '../../native-snippets';
import { Screen } from '../../screens/NativeScreens';
import { useReaderRuntime } from '../../platform/RuntimeProvider.native';
export default function SnippetsRoute() {
  const { snapshot, command } = useReaderRuntime();
  return <Screen title="Snippets"><NativeSnippetsScreen identity={`${snapshot.session}:${snapshot.epoch}`} revision={snapshot.revision} request={command} onRead={id => { router.push({ pathname: '/b', params: { snippet: id } }); }}/></Screen>;
}
