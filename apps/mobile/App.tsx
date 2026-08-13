import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { DemoShell } from './src/demo/DemoShell';
import { LiveShell } from './src/LiveShell';

const api = process.env.EXPO_PUBLIC_CROWDFLOW_API;
const origin = process.env.EXPO_PUBLIC_CROWDFLOW_ORIGIN;
const destination = process.env.EXPO_PUBLIC_CROWDFLOW_DESTINATION;

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {api && origin && destination
        ? <LiveShell config={{ api, origin, destination }} />
        : <DemoShell />}
    </SafeAreaProvider>
  );
}
