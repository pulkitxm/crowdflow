
import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { DemoShell } from './src/demo/DemoShell';
import { LiveShell } from './src/LiveShell';
import { isCurrent, readConsent, recordConsent, setSharing, withdrawConsent, type ConsentRecord } from './src/consent';
import { createCircuitSource } from './src/circuits/registry';
import { createRaceSource } from './src/events/registry';
import { storeRace, storedRace, type SelectedRace } from './src/events/selection';
import { LandingScreen } from './src/screens/LandingScreen';
import { LocationConsent } from './src/screens/LocationConsent';
import { RacePicker } from './src/screens/RacePicker';
import { SensingSettings } from './src/screens/SensingSettings';
import { LocationCheck } from './src/screens/LocationCheck';
import { useSensing } from './src/sensing/useSensing';

const api = process.env.EXPO_PUBLIC_CROWDFLOW_API;
const origin = process.env.EXPO_PUBLIC_CROWDFLOW_ORIGIN;
const destination = process.env.EXPO_PUBLIC_CROWDFLOW_DESTINATION;
const sensingMode = process.env.EXPO_PUBLIC_CROWDFLOW_SENSING === 'rehearsal' ? 'rehearsal' : 'device';
const circuits = createCircuitSource(api);
const raceSource = createRaceSource(api);

type Stage = 'consent' | 'check' | 'landing' | 'picker' | 'app' | 'sensing';

export default function App() {
  const [stage, setStage] = useState<Stage>('consent');
  const [race, setRace] = useState<SelectedRace | null>(null);
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [record, stored] = await Promise.all([readConsent(), storedRace()]);
      setConsent(isCurrent(record) ? record : null);
      setRace(stored);
      setStage(isCurrent(record) ? 'check' : 'consent');
      setReady(true);
    })();
  }, []);

  const sensing = useSensing({
    baseUrl: api ?? '',
    source: circuits,
    circuitId: race?.has_map ? race.circuit_id : null,
    enabled: isCurrent(consent) && consent.sharing && race?.has_map === true,
    mode: sensingMode,
  });

  const choose = useCallback(async (next: SelectedRace) => {
    setRace(next);
    await storeRace(next);
    setStage('landing');
  }, []);

  const changeSharing = useCallback(async (sharing: boolean) => {
    if (!consent) return;
    setConsent(await setSharing(consent, sharing));
  }, [consent]);

  const revoke = useCallback(async () => {
    await withdrawConsent();
    setConsent(null);
    setStage('consent');
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {stage === 'consent' ? (
        <LocationConsent
          onDone={async () => {
            setConsent(await recordConsent());
            setStage('check');
          }}
        />
      ) : null}
      {}
      {stage === 'check' ? <LocationCheck onContinue={() => setStage('landing')} /> : null}
      {stage === 'landing' ? (
        <LandingScreen
          race={race}
          sensing={sensing.status}
          onSelect={() => setStage('picker')}
          onContinue={() => setStage('app')}
          onSensing={() => setStage('sensing')}
        />
      ) : null}
      {stage === 'picker' ? (
        <RacePicker
          source={raceSource}
          circuits={circuits}
          selectedId={race?.id ?? null}
          onPick={(next) => void choose(next)}
          onBack={() => setStage('landing')}
        />
      ) : null}
      {stage === 'sensing' && consent ? (
        <SensingSettings
          status={sensing.status ?? { active: false, queued: 0, available: [], using: null, last_fix: null, blocked_by: sensing.problem ? [sensing.problem] : [] }}
          sharing={consent.sharing}
          pseudonymExpiresIn={sensing.pseudonymExpiresIn}
          survey={sensing.survey}
          onSharingChange={(next) => void changeSharing(next)}
          onWithdraw={() => void revoke()}
          onBack={() => setStage('landing')}
        />
      ) : null}
      {stage === 'app' ? (
        api && origin && destination
          ? <LiveShell config={{ api, origin, destination }} />
          : <DemoShell />
      ) : null}
    </SafeAreaProvider>
  );
}
