import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { SpectatorView } from '@crowdflow/contracts';
import { SpectatorApp } from './SpectatorApp';
import { LiveSpectatorFeed } from './feed/live';

export interface LiveShellConfig { api: string; origin: string; destination: string }
export function LiveShell({ config }: { config: LiveShellConfig }) {
  const [view, setView] = useState<SpectatorView | null>(null); const [problem, setProblem] = useState<string | null>(null);
  const feed = useMemo(() => new LiveSpectatorFeed({ baseUrl: config.api, origin: config.origin, destination: config.destination }), [config.api, config.origin, config.destination]);
  useEffect(() => { const unsubscribe = feed.subscribe((next) => { setView(next); setProblem(null); }); feed.start((error) => setProblem(error instanceof Error ? error.message : String(error))); return () => { unsubscribe(); feed.stop(); }; }, [feed]);
  if (view) return <SpectatorApp view={view} />;
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}><Text>{problem ? 'Live guidance is unavailable.' : 'Finding your route…'}</Text></View>;
}
