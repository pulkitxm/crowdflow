
import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { DemoShell } from './src/demo/DemoShell';
import { LiveShell } from './src/LiveShell';
import { isCurrent, readConsent, recordConsent, setSharing, withdrawConsent, type ConsentRecord } from './src/consent';
import { createCircuitSource } from './src/circuits/registry';
import { createRaceSource } from './src/events/registry';
import { storeRace, storedRace, toSelected, type SelectedRace } from './src/events/selection';
import { storePersonId, storedPersonId } from './src/identity';
import { LandingScreen } from './src/screens/LandingScreen';
import { LocationConsent } from './src/screens/LocationConsent';
import { PersonLogin } from './src/screens/PersonLogin';
import { RacePicker } from './src/screens/RacePicker';
import { SensingSettings } from './src/screens/SensingSettings';
import { LocationCheck } from './src/screens/LocationCheck';
import { useAppFonts } from './src/ui/fonts';
import { useSensing } from './src/sensing/useSensing';

const api = process.env.EXPO_PUBLIC_CROWDFLOW_API;
const origin = process.env.EXPO_PUBLIC_CROWDFLOW_ORIGIN;
const destination = process.env.EXPO_PUBLIC_CROWDFLOW_DESTINATION;
const sensingMode = process.env.EXPO_PUBLIC_CROWDFLOW_SENSING === 'rehearsal' ? 'rehearsal' : 'device';
const preferredCircuit = process.env.EXPO_PUBLIC_CROWDFLOW_CIRCUIT ?? 'silverstone';
const circuits = createCircuitSource(api);
const raceSource = createRaceSource(api);

type Stage = 'login' | 'consent' | 'check' | 'landing' | 'picker' | 'app' | 'sensing';

async function registerPerson(personId: number, circuitId: string): Promise<void> {
  if (!api) return;
  const response = await fetch(`${api.replace(/\/$/, '')}/api/people/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ person_id: personId, circuit_id: circuitId }),
  });
  if (!response.ok) throw new Error(`The circuit could not register this ID (${response.status}).`);
}

export default function App() {
  const [stage, setStage] = useState<Stage>('login');
  const [personId, setPersonId] = useState<number | null>(null);
  const [race, setRace] = useState<SelectedRace | null>(null);
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [ready, setReady] = useState(false);
  const fontsReady = useAppFonts();

  useEffect(() => {
    (async () => {
      const [record, stored, person] = await Promise.all([readConsent(), storedRace(), storedPersonId()]);
      let selected = stored;
      if (!selected) {
        const races = await raceSource.list().catch(() => []);
        const preferred = races.find((item) => item.circuit_id === preferredCircuit && item.has_map)
          ?? races.find((item) => item.has_map);
        selected = preferred ? toSelected(preferred) : null;
        if (selected) await storeRace(selected);
      }
      setConsent(isCurrent(record) ? record : null);
      setRace(selected);
      setPersonId(person);
      setStage(person == null ? 'login' : isCurrent(record) ? 'check' : 'consent');
      setReady(true);
    })();
  }, []);

  const sensing = useSensing({
    baseUrl: api ?? '',
    source: circuits,
    circuitId: race?.has_map ? race.circuit_id : null,
    personId,
    enabled: personId != null && isCurrent(consent) && consent.sharing && race?.has_map === true,
    mode: sensingMode,
  });

  const choose = useCallback(async (next: SelectedRace) => {
    if (personId != null) await registerPerson(personId, next.circuit_id);
    setRace(next);
    await storeRace(next);
    setStage('landing');
  }, [personId]);

  const login = useCallback(async (nextPersonId: number) => {
    await registerPerson(nextPersonId, race?.circuit_id ?? preferredCircuit);
    await storePersonId(nextPersonId);
    setPersonId(nextPersonId);
    setStage(isCurrent(consent) ? 'check' : 'consent');
  }, [consent, race]);

  const changeSharing = useCallback(async (sharing: boolean) => {
    if (!consent) return;
    setConsent(await setSharing(consent, sharing));
  }, [consent]);

  const revoke = useCallback(async () => {
    await withdrawConsent();
    setConsent(null);
    setStage('consent');
  }, []);

  if (!ready || !fontsReady) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {stage === 'login' ? <PersonLogin onLogin={login} /> : null}
      {stage === 'consent' ? (
        <LocationConsent
          onDone={async () => {
            setConsent(await recordConsent());
            setStage('check');
          }}
        />
      ) : null}
      {stage === 'check' ? <LocationCheck onContinue={() => setStage('landing')} /> : null}
      {stage === 'landing' ? (
        <LandingScreen
          race={race}
          personId={personId!}
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
