import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { DemoShell } from './src/demo/DemoShell';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <DemoShell />
    </SafeAreaProvider>
  );
}
