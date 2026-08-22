import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SpectatorView } from '@crowdflow/contracts';
import { SpectatorApp } from './SpectatorApp';
import { LiveSpectatorFeed } from './feed/live';
import { space } from './theme';
import { Body, Headline } from './ui/atoms';
import { usePalette } from './ui/theme';

export interface LiveShellConfig { api: string; origin: string; destination: string }

export function LiveShell({ config }: { config: LiveShellConfig }) {
  const [view, setView] = useState<SpectatorView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const feed = useMemo(
    () => new LiveSpectatorFeed({ baseUrl: config.api, origin: config.origin, destination: config.destination }),
    [config.api, config.origin, config.destination],
  );

  useEffect(() => {
    const unsubscribe = feed.subscribe((next) => { setView(next); setProblem(null); });
    feed.start((error) => setProblem(error instanceof Error ? error.message : String(error)));
    return () => { unsubscribe(); feed.stop(); };
  }, [feed]);

  if (view) return <SpectatorApp view={view} />;
  return <Waiting problem={problem} />;
}

function Waiting({ problem }: { problem: string | null }) {
  const palette = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.paper }} edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>
        {problem ? null : <ActivityIndicator color={palette.ink} size="large" />}
        <Headline style={{ textAlign: 'center' }}>
          {problem ? 'Guidance is unavailable.' : 'Finding your route…'}
        </Headline>
        <Body tone="soft" style={{ textAlign: 'center' }}>
          {problem
            ? 'The circuit could not be reached. This screen will fill in as soon as it is back.'
            : 'This takes a moment while your phone works out where you are.'}
        </Body>
      </View>
    </SafeAreaView>
  );
}
