/**
 * The app's shell: which screen, and whether the phone is sensing.
 *
 * The stages before the app proper are a policy, not a flow. The disclosure comes
 * first because everything after it depends on a position. The RACE comes next,
 * because it is the one thing the app must not assume — the venue frame, the
 * anchor map and the timetable are all properties of one weekend at one place,
 * and sensing cannot start before there is a venue to sense in.
 *
 * Sensing itself is one boolean: consent is current AND sharing is on AND a race
 * is chosen. Nothing else can start it, and any of the three going false stops it
 * within a tick. That is the whole of the consent enforcement, deliberately in
 * one expression — a permission model spread across four screens is a permission
 * model with a way around it.
 */

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
// TEMPORARY: the location verification screen. See the header of
// src/screens/LocationCheck.tsx for the deletions that remove it.
import { LocationCheck } from './src/screens/LocationCheck';
import { useSensing } from './src/sensing/useSensing';

const api = process.env.EXPO_PUBLIC_CROWDFLOW_API;
const origin = process.env.EXPO_PUBLIC_CROWDFLOW_ORIGIN;
const destination = process.env.EXPO_PUBLIC_CROWDFLOW_DESTINATION;
/**
 * `rehearsal` replaces the three radios with the simulator in
 * `src/sensing/rehearsal.ts` and changes nothing else. It is how the stack is
 * exercised on a laptop, on web, or on a phone with no venue survey — and it is
 * an explicit environment variable rather than a fallback, so no build can end up
 * rehearsing when it believes it is sensing.
 */
const sensingMode = process.env.EXPO_PUBLIC_CROWDFLOW_SENSING === 'rehearsal' ? 'rehearsal' : 'device';
/**
 * Two sources, one API. Races answer "which weekend"; circuits answer "what does
 * the venue look like and where are its radio anchors". They are separate
 * because they decay on different clocks — a calendar is reimported every season,
 * a circuit's geography is good for a decade.
 */
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
      // A record from an older disclosure is an agreement to something else. The
      // person is asked again rather than upgraded on their behalf.
      setConsent(isCurrent(record) ? record : null);
      setRace(stored);
      // TEMPORARY: opens on the location check rather than the landing page, so
      // launching the app and allowing location is the whole test. Change
      // 'check' back to 'landing' to remove.
      setStage(isCurrent(record) ? 'check' : 'consent');
      setReady(true);
    })();
  }, []);

  const sensing = useSensing({
    baseUrl: api ?? '',
    source: circuits,
    // Only a mapped venue can be sensed: without a circuit pack there is no
    // frame to place a position in and no bounds to stop reporting at.
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
            // TEMPORARY: 'check' instead of 'landing'. See LocationCheck.tsx.
            setStage('check');
          }}
        />
      ) : null}
      {/* TEMPORARY: the location verification screen. */}
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
