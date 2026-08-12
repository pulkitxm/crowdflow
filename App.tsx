import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { createRuntime } from './src/runtime/createRuntime';
import type { CrowdNodeRuntime } from './src/runtime/crowdNodeRuntime';
import { initialRuntimeState, type RuntimeState } from './src/runtime/runtimeState';
import { DebugScreen } from './src/ui/DebugScreen';
import { HomeScreen } from './src/ui/HomeScreen';
import { PrivacyScreen } from './src/ui/PrivacyScreen';
import { colors } from './src/ui/theme';
import { demoVenue } from './src/venue/demoVenue';

type Screen = 'home' | 'debug' | 'privacy';

export default function App() {
  const [runtime, setRuntime] = useState<CrowdNodeRuntime>();
  const [state, setState] = useState<RuntimeState>(initialRuntimeState);
  const [screen, setScreen] = useState<Screen>('home');
  const [bootstrapError, setBootstrapError] = useState<string>();

  useEffect(() => {
    let active = true; let unsubscribe: (() => void) | undefined; let created: CrowdNodeRuntime | undefined;
    void createRuntime().then((value) => {
      if (!active) { void value.stop(); return; }
      created = value; setRuntime(value); setState(value.snapshot());
      unsubscribe = value.changed.subscribe(setState);
    }).catch((error) => setBootstrapError(String(error)));
    return () => { active = false; unsubscribe?.(); if (created) void created.stop(); };
  }, []);

  return <SafeAreaProvider><SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <StatusBar style="dark" />
    {bootstrapError ? <View style={styles.center}><Text style={styles.error}>{bootstrapError}</Text></View> :
      !runtime ? <View style={styles.center}><ActivityIndicator color={colors.moss} size="large" /><Text style={styles.loading}>Preparing private mesh…</Text></View> :
      screen === 'debug' ? <DebugScreen state={state} runtime={runtime} onBack={() => setScreen('home')} /> :
      screen === 'privacy' ? <PrivacyScreen onBack={() => setScreen('home')} /> :
      <HomeScreen graph={demoVenue} state={state} onDebug={() => setScreen('debug')} onPrivacy={() => setScreen('privacy')} onStart={() => void runtime.start()} />}
  </SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: colors.cream },
  loading: { color: colors.muted, marginTop: 12, fontWeight: '700' }, error: { color: colors.signal, textAlign: 'center', fontWeight: '700' },
});
