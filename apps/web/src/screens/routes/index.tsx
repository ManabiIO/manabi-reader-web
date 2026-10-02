/** @license BSD-3-Clause */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { useReaderRuntime } from '../../platform/RuntimeProvider.native';
export default function Home() {
  const { snapshot, command } = useReaderRuntime();
  useEffect(() => { if (!snapshot.session || snapshot.loading) return; let active = true; if (snapshot.lastBookId) void command('open', { bookId: snapshot.lastBookId }).then(() => { if (active) router.replace({ pathname: '/b', params: { id: snapshot.lastBookId } }); }).catch(() => { if (active) router.replace('/manage'); }); else router.replace('/manage'); return () => { active = false; }; }, [snapshot.session, snapshot.epoch, snapshot.loading, snapshot.lastBookId, command]);
  return <View style={{flex:1,justifyContent:'center'}}><ActivityIndicator accessibilityLabel="Opening Library"/></View>;
}
