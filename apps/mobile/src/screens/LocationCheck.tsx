
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

const FRAME = DEMO_GEOMETRY.pack.frame as unknown as CoordinateFrame;

interface RadioReading {
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
    await startWatch();
    void scanRadios();
  }, [startWatch, scanRadios]);

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

      {}
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
