/** @license BSD-3-Clause */
import { Text, View } from 'react-native';
import { Screen } from '../screens/NativeScreens';
export default function NativeRoute() { return <Screen title='Shared libraries'><View style={{padding:24,gap:12}}><Text accessibilityRole="header">Android migration in progress</Text><Text>This feature is implemented on web. Its native controls are still being ported in this draft; no existing data has been converted or removed.</Text></View></Screen>; }
