import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme';
import { Body, Card, PrimaryAction, SecondaryAction } from '../ui/atoms';
import { Chip, Page, Section } from '../ui/layout';
import { useStep } from '../ui/responsive';
import { usePalette } from '../ui/theme';
import { requestBackground, requestBluetooth, requestForeground, type PermissionState } from '../sensing/permissions';

interface Point {
  title: string;
  detail: string;
}

const POINTS: Point[] = [
  {
    title: 'Where you are, while you are here',
    detail:
      'Your phone works out roughly where it is on the circuit. That is what guides you, and what keeps the walkways moving. It stops the moment you leave.',
  },
  {
    title: 'GPS, helped by Wi-Fi and Bluetooth',
    detail:
      'Under a grandstand or in a tunnel, GPS alone is poor. Your phone also listens for the Wi-Fi and Bluetooth signals around it so it can still place you.',
  },
  {
    title: 'The list of signals stays on your phone',
    detail:
      'Which networks and beacons your phone can hear never leaves it. Only the position your phone worked out is sent.',
  },
  {
    title: 'One position, never a trail',
    detail:
      'Each update replaces the one before it. The circuit team sees your person ID, where you are now, how precise that is, and which radio placed you.',
  },
];

interface Ask {
  key: 'location' | 'bluetooth' | 'background';
  label: string;
  plain: string;
  why: string;
  ifDeclined: string;
  required: boolean;
  granted(state: PermissionState): boolean;
  request(): Promise<PermissionState>;
}

const ASKS: Ask[] = [
  {
    key: 'location',
    label: 'Your position',
    plain: 'Needed',
    why: 'Places you on the circuit. Nothing below works without it.',
    ifDeclined: 'The app still opens, but it cannot guide you.',
    required: true,
    granted: (state) => state.foreground,
    request: requestForeground,
  },
  {
    key: 'bluetooth',
    label: 'Bluetooth',
    plain: 'Optional',
    why: 'Uses the beacons at gates and under cover, where GPS is weakest and the crowd is thickest.',
    ifDeclined: 'Guidance still works outdoors, and gets vaguer indoors.',
    required: false,
    granted: (state) => state.bluetooth,
    request: requestBluetooth,
  },
  {
    key: 'background',
    label: 'While your phone is locked',
    plain: 'Optional',
    why: 'Your phone spends most of the day in a pocket. This lets it keep helping while it is there.',
    ifDeclined: 'Sharing pauses whenever the app is closed. Nothing else changes.',
    required: false,
    granted: (state) => state.background,
    request: requestBackground,
  },
];

export function LocationConsent({ onDone }: { onDone: () => void }) {
  const palette = usePalette();
  const step = useStep();
  const [stage, setStage] = useState<'disclosure' | 'permissions'>('disclosure');
  const [state, setState] = useState<PermissionState | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const ask = async (item: Ask) => {
    setBusy(item.key);
    try {
      setState(await item.request());
      setAsked((previous) => new Set(previous).add(item.key));
    } finally {
      setBusy(null);
    }
  };

  if (stage === 'disclosure') {
    return (
      <Page
        eyebrow="Before you walk in"
        title="Your position, used to keep the circuit moving."
        lede="Four things worth knowing. Then we will ask, one at a time."
        footer={<PrimaryAction label="Continue" onPress={() => setStage('permissions')} />}
      >
        <View style={{ gap: step(space.md) }}>
          {POINTS.map((point) => (
            <Card key={point.title} tone="outline" style={{ gap: step(space.xs) }}>
              <View style={styles.pointHead}>
                <View style={[styles.bullet, { backgroundColor: palette.ink }]} />
                <Body color={palette.ink} style={{ fontWeight: '700', flex: 1 }}>
                  {point.title}
                </Body>
              </View>
              <Body tone="soft" style={styles.detail}>
                {point.detail}
              </Body>
            </Card>
          ))}
        </View>

        <Body tone="soft" style={styles.finePrint}>
          You can stop sharing at any time, from inside the app.
        </Body>
      </Page>
    );
  }

  const locationSettled = asked.has('location');

  return (
    <Page
      eyebrow="Three requests"
      title="Only the first one is needed."
      lede="You can change any of these later, here or in your phone's settings."
      footer={
        <PrimaryAction
          label={locationSettled ? 'Done, take me in' : 'Skip for now'}
          onPress={onDone}
        />
      }
    >
      {ASKS.map((item) => {
        const granted = state ? item.granted(state) : false;
        return (
          <Card key={item.key} tone="outline" style={{ gap: step(space.sm) }}>
            <View style={styles.askHead}>
              <Body color={palette.ink} style={{ fontWeight: '700', flex: 1 }}>
                {item.label}
              </Body>
              <Chip
                label={granted ? 'allowed' : item.plain}
                tone={granted ? 'strong' : item.required ? 'warn' : 'quiet'}
              />
            </View>
            <Body tone="soft" style={styles.detail}>
              {item.why}
            </Body>
            {granted ? null : (
              <View style={{ gap: step(space.sm) }}>
                <Body tone="soft" style={[styles.detail, { opacity: 0.75 }]}>
                  If you say no: {item.ifDeclined}
                </Body>
                <SecondaryAction
                  label={asked.has(item.key) ? 'Ask again' : `Allow ${item.label.toLowerCase()}`}
                  onPress={busy ? undefined : () => void ask(item)}
                  disabled={busy === item.key}
                />
              </View>
            )}
          </Card>
        );
      })}

      {state?.blockedBy.length ? (
        <Section label="Switched off on this phone">
          <Card tone="outline" style={{ gap: step(space.xs) }}>
            {state.blockedBy.map((reason) => (
              <Body key={reason} tone="soft" style={styles.detail}>
                {reason}
              </Body>
            ))}
          </Card>
        </Section>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  pointHead: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  bullet: { width: 8, height: 8, borderRadius: radius.pill },
  detail: { fontSize: 15, lineHeight: 22 },
  finePrint: { fontSize: 15, lineHeight: 22 },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
