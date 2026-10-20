// Explicit initialization is required by SDK 56. The Metro platform resolver
// selects RN Windows here; no Expo native-module fallback is installed.
import 'react-native/Libraries/Core/InitializeCore';
import { AppRegistry } from 'react-native';
import Bootstrap from './src/Bootstrap';

AppRegistry.registerComponent('ManabiReaderWindows', () => Bootstrap);
