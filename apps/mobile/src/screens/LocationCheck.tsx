/**
 * TEMPORARY VERIFICATION SCREEN — delete when it has served its purpose.
 *
 * Its one job: open the app, allow location, and see your own position on
 * screen, with the three radios reporting whether they actually work on THIS
 * handset. Nothing else — no server, no circuit choice, no crowd picture.
 *
 * ---------------------------------------------------------------------------
 * TO REMOVE IT (three deletions, no other code touches it):
 *   1. delete this file
 *   2. in App.tsx: remove the `LocationCheck` import, the `'check'` entry in
 *      `Stage`, the block that renders it, and change the two places that set
 *      stage to 'check' back to 'landing'
 *   3. that is all — nothing else imports this
 * ---------------------------------------------------------------------------
 *
 * Two design choices worth stating, because both are about not lying during a
 * verification.
 *
 * IT DOES NOT RUN `SensingEngine`. The engine geofences every fix to the chosen
 * circuit's bounds, which is correct behaviour and exactly wrong here: whoever
 * is holding this phone is almost certainly not at Silverstone, so the engine
 * would correctly report nothing and the screen would read as broken. This
 * screen shows the raw truth instead, and says plainly whether that position
 * falls inside the demo circuit.
 *
 * IT SHOWS THE RAW COORDINATE. The rest of the app never does — positions are
 * venue metres, and a latitude is the one thing this system is built to avoid
 * handling. It is here because "is this actually my location" cannot be answered
 * by an x/y in a frame whose origin is a field in Northamptonshire. The
 * coordinate is displayed and never stored, never queued and never uploaded;
 * there is no uplink on this screen at all.
 *
 * The radio rows reuse the real `WifiSensor` and `BleSensor`, so what they show
 * is what the shipping stack sees. They report a COUNT and the strongest signal,
 * never a network name: an SSID list is a description of where somebody is
 * precise enough to name the room, and `WifiSensor` hashes identifiers on the
 * way out for that reason. Nothing here can un-hash them.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import type { CoordinateFrame, Position, RadioObservation } from '@crowdflow/contracts';
import { insideVenue, toVenue } from '@crowdflow/core/positioning';

import { DEMO_GEOMETRY } from '../circuits/demo';
import { RealLocationMap } from './RealLocationMap';
import { BleSensor } from '../sensing/ble';
import { WifiSensor } from '../sensing/wifi';
import { currentPermissions, requestBluetooth, requestForeground, type PermissionState } from '../sensing/permissions';
import type { AnchorScanner } from '../sensing/types';
import { radius, space } from '../theme';
import { Body, Card } from '../ui/atoms';
import { Chip, MetaRow, Page, Section } from '../ui/layout';
import { usePalette } from '../ui/theme';

// The bundled pack is a frozen literal, so its tuples are `readonly` and the
// contract's are not. Widened once, here, rather than cast at each call.
const FRAME = DEMO_GEOMETRY.pack.frame as unknown as CoordinateFrame;

interface RadioReading {
  /** null while it has not been tried, so "not scanned" and "heard nothing" stay
   *  distinguishable — they mean completely different things about a handset. */
  heard: number | null;
  strongestDbm: number | null;
  reason: string | null;
}

const NOT_TRIED: RadioReading = { heard: null, strongestDbm: null, reason: null };

export function LocationCheck({ onContinue }: { onContinue: () => void }) {
  const palette = usePalette();
  const [permissions, setPermissions] = useState<PermissionState | null>(null);
  const [position, setPosition] = useState<Location.LocationObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wifi, setWifi] = useState<RadioReading>(NOT_TRIED);
  const [ble, setBle] = useState<RadioReading>(NOT_TRIED);
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);

  const watch = useRef<Location.LocationSubscription | null>(null);
  const wifiSensor = useRef(new WifiSensor());
  const bleSensor = useRef(new BleSensor());

  useEffect(() => { void currentPermissions().then(setPermissions); }, []);

  // A one-second tick so the fix's age counts up on screen. A coordinate with no
  // age beside it is a photograph presented as a window — and during a
  // verification, a frozen reading is the exact thing you need to notice.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  const startWatch = useCallback(async () => {
    if (watch.current) return;
    try {
      watch.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
        (next) => { setPosition(next); setError(null); },
      );
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'the location watch could not start');
    }
  }, []);

  const scanRadios = useCallback(async () => {
    setScanning(true);
    const rungs: { sensor: AnchorScanner; set: (reading: RadioReading) => void }[] = [
      { sensor: wifiSensor.current, set: setWifi },
      { sensor: bleSensor.current, set: setBle },
    ];
    for (const { sensor, set } of rungs) {
      const availability = await sensor.availability();
      if (!availability.usable) {
        set({ heard: null, strongestDbm: null, reason: availability.reason ?? 'unavailable' });
        continue;
      }
      await sensor.start?.();
      // BLE is a subscription: advertisements arrive continuously, so give it a
      // window to hear anything at all before draining it. A Wi-Fi scan is a
      // one-shot call and ignores the wait.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const observations: RadioObservation[] = await sensor.scan(Date.now() / 1000).catch(() => []);
      set({
        heard: observations.length,
        strongestDbm: observations.length ? Math.max(...observations.map((o) => o.rssi_dbm)) : null,
        reason: null,
      });
    }
    setScanning(false);
  }, []);

  const enable = useCallback(async () => {
    let state = await requestForeground();
    if (state.foreground) state = await requestBluetooth();
    setPermissions(state);
    // Start the watch WHATEVER the permission query reported. On the web,
    // `requestForegroundPermissionsAsync` goes through the Permissions API,
    // which answers "prompt" rather than "granted" until a position is actually
    // requested — so gating the watch on `state.foreground` leaves a browser
    // stuck on this screen forever with the button doing nothing. The watch is
    // what raises the real prompt; if it is genuinely denied, it throws and the
    // catch in `startWatch` puts the reason on screen.
    await startWatch();
    void scanRadios();
  }, [startWatch, scanRadios]);

  // If permission was already granted on the disclosure screen, start without
  // making somebody press a second button for something they already allowed.
  useEffect(() => {
    if (permissions?.foreground && !watch.current) { void startWatch(); void scanRadios(); }
  }, [permissions?.foreground, startWatch, scanRadios]);

  useEffect(() => () => {
    watch.current?.remove();
    watch.current = null;
    void bleSensor.current.stop();
  }, []);

  const coords = position?.coords ?? null;
  const venue: Position | null = coords ? toVenue(FRAME, { lat: coords.latitude, lon: coords.longitude }) : null;
  const inside = venue ? insideVenue(FRAME, venue) : false;
  const ageS = position ? Math.max(0, now - position.timestamp / 1000) : null;

  return (
    <Page
      eyebrow="Location check"
      title={
        coords
          ? `You are here, to about ${Math.round(coords.accuracy ?? 0)} m.`
          : permissions?.foreground
            ? 'Waiting for your first fix…'
            : 'Allow location to see where you are.'
      }
      lede="A temporary screen for checking the location feature on this phone. Nothing here is saved or sent anywhere."
      footer={<Action label="Continue to the app" note="" onPress={onContinue} />}
    >
      {coords ? (
        <RealLocationMap lat={coords.latitude} lon={coords.longitude} accuracyM={coords.accuracy ?? null} />
      ) : null}

      {coords ? (
        <Card tone="outline" style={{ gap: space.md }}>
          <MetaRow label="Latitude" value={coords.latitude.toFixed(6)} emphasis />
          <MetaRow label="Longitude" value={coords.longitude.toFixed(6)} emphasis />
          <MetaRow label="Accuracy" value={`± ${(coords.accuracy ?? 0).toFixed(1)} m`} />
          <MetaRow label="Altitude" value={coords.altitude == null ? 'not reported' : `${coords.altitude.toFixed(0)} m`} />
          <MetaRow label="Reading age" value={ageS == null ? '—' : `${ageS.toFixed(0)}s ago`} />
        </Card>
      ) : null}

      <Section
        label="The three radios on this phone"
        note="Counts and signal strengths only — never a network name. Nothing on this screen can tell you which networks these were."
      >
        <Card tone="outline" style={{ gap: space.md }}>
          <RadioRow
            label="GPS"
            unit="fix"
            reading={{
              heard: coords ? 1 : null,
              strongestDbm: null,
              reason: coords ? null : (permissions?.blockedBy[0] ?? 'no fix yet'),
            }}
          />
          <RadioRow label="Wi-Fi" reading={wifi} unit="access points" />
          <RadioRow label="Bluetooth" reading={ble} unit="devices" />
        </Card>
      </Section>

      {error ? <Card tone="outline"><Body tone="soft" style={styles.small}>{error}</Body></Card> : null}

      {permissions?.blockedBy.length ? (
        <Section label="What is switched off">
          <Card tone="outline" style={{ gap: space.xs }}>
            {permissions.blockedBy.map((reason) => (
              <Body key={reason} tone="soft" style={styles.small}>{reason}</Body>
            ))}
          </Card>
        </Section>
      ) : null}

      {permissions?.foreground ? null : (
        <Action label="Enable location" note="Then this screen fills in." onPress={() => void enable()} />
      )}

      <Action
        label={scanning ? 'Scanning…' : 'Scan Wi-Fi and Bluetooth again'}
        note="Android limits Wi-Fi scans to four every two minutes, so this may repeat the last result."
        onPress={() => { if (!scanning) void scanRadios(); }}
      />

      {/* Last, and small. It is a fact about a circuit nobody is standing in,
          kept because it is the one thing that proves the venue projection is
          wired correctly — but it is not what this screen is for. */}
      {venue ? (
        <Section label="Footnote — the circuit frame">
          <Card tone="outline">
            <Body tone="soft" style={styles.small}>
              Measured from Silverstone's origin, you are {venue.x.toFixed(0)} m east and{' '}
              {venue.y.toFixed(0)} m north — {inside ? 'inside its bounds' : 'far outside its bounds'}.
              {inside
                ? ' The app would report this position.'
                : ' The real app stops reporting outside a venue, which is why the crowd side of this build shows nothing from here. The conversion itself is working.'}
            </Body>
          </Card>
        </Section>
      ) : null}
    </Page>
  );
}

/**
 * One radio's state in one line.
 *
 * Three outcomes, kept apart: not tried yet, tried and heard nothing, and
 * unavailable for a stated reason. Collapsing the last two is what makes a phone
 * with Bluetooth switched off look identical to a phone in an empty field.
 */
function RadioRow({ label, reading, unit }: { label: string; reading: RadioReading; unit: string }) {
  const palette = usePalette();
  const value = reading.reason
    ? 'unavailable'
    : reading.heard == null
      ? 'not checked yet'
      : reading.heard === 0
        ? `heard nothing`
        : `${reading.heard} ${unit}${reading.strongestDbm == null ? '' : `, strongest ${reading.strongestDbm} dBm`}`;
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.radioHead}>
        <Body color={palette.ink} style={{ fontWeight: '700', flex: 1 }}>{label}</Body>
        {reading.reason
          ? <Chip label="unavailable" tone="warn" />
          : reading.heard
            ? <Chip label="working" tone="strong" />
            : <Chip label={reading.heard === 0 ? 'nothing heard' : 'not checked'} />}
      </View>
      <Body tone="soft" style={styles.small}>{reading.reason ?? value}</Body>
    </View>
  );
}

function Action({ label, note, onPress }: { label: string; note: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, { borderColor: palette.line, opacity: pressed ? 0.7 : 1 }]}
    >
      <Body color={palette.ink} style={{ fontWeight: '700' }}>{label}</Body>
      {note ? <Body tone="soft" style={styles.small}>{note}</Body> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  radioHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  small: { fontSize: 15, lineHeight: 21 },
  action: {
    borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4,
    minHeight: 64, justifyContent: 'center',
  },
});
