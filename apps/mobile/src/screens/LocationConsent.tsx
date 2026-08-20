
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space } from '../theme';
import { Body, Card, PrimaryAction, Title } from '../ui/atoms';
import { Chip, Page } from '../ui/layout';
import { usePalette } from '../ui/theme';
import { requestBackground, requestBluetooth, requestForeground, type PermissionState } from '../sensing/permissions';

const POINTS = [
  'Your phone works out roughly where it is on the circuit, and we use that to guide you and keep the walkways moving.',
  'It places itself using GPS and, where that is poor under a grandstand or in a tunnel, the Wi-Fi and Bluetooth signals around it.',
  'Which networks and beacons your phone can hear never leaves your phone. Only the position it worked out is sent, and only while you are at the circuit.',
  'Your person ID links to your current circuit position. Each update replaces the previous position, so the dashboard does not build a location trail.',
  'The circuit team can see your person ID, current position, accuracy, and whether the fix came from GPS, Wi-Fi, or Bluetooth.',
  'The moment you leave the circuit, reporting stops. You can stop it sooner from the app at any time.',
] as const;

interface Ask {
  key: 'location' | 'bluetooth' | 'background';
  label: string;
  why: string;
  ifDeclined: string;
  granted(state: PermissionState): boolean;
  request(): Promise<PermissionState>;
}

const ASKS: Ask[] = [
  {
    key: 'location',
    label: 'Your position',
    why: 'Places you on the circuit. Without it nothing below works either. Android ties the Wi-Fi and Bluetooth signal lists to this same permission.',
    ifDeclined: 'You can still use the app, but it cannot guide you.',
    granted: (state) => state.foreground,
    request: requestForeground,
  },
  {
    key: 'bluetooth',
    label: 'Bluetooth',
    why: 'Uses the beacons at gates and under cover, where GPS is weakest and the crowd is thickest.',
    ifDeclined: 'Guidance still works outdoors, and gets vaguer indoors.',
    granted: (state) => state.bluetooth,
    request: requestBluetooth,
  },
  {
    key: 'background',
    label: 'While your phone is locked',
    why: 'Your phone spends most of the day in a pocket. This is what lets it keep helping the crowd picture while it is there.',
    ifDeclined: 'Sharing pauses whenever the app is closed. Nothing else changes.',
    granted: (state) => state.background,
    request: requestBackground,
  },
];

export function LocationConsent({ onDone }: { onDone: () => void }) {
  const palette = usePalette();
  const [stage, setStage] = useState<'disclosure' | 'permissions'>('disclosure');
  const [state, setState] = useState<PermissionState | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());

  const ask = async (item: Ask) => {
    setState(await item.request());
    setAsked((previous) => new Set(previous).add(item.key));
  };

  if (stage === 'disclosure') {
    return (
      <Page
        eyebrow="Before you walk in"
        title="Your position, used to keep the circuit moving."
        footer={
          <Pressable
            accessibilityRole="button"
            onPress={() => setStage('permissions')}
            style={({ pressed }) => [styles.continue, { backgroundColor: palette.actionFill, opacity: pressed ? 0.85 : 1 }]}
          >
            <Title style={{ color: palette.actionText }}>Continue</Title>
            <Body style={{ color: palette.actionText, opacity: 0.85 }}>Then we will ask, one thing at a time.</Body>
          </Pressable>
        }
      >
        <Card tone="outline">
          <View style={{ gap: space.md }}>
            {POINTS.map((point) => (
              <View key={point} style={styles.point}>
                <View style={[styles.bullet, { backgroundColor: palette.ink }]} />
                <Body tone="soft" style={styles.pointText}>{point}</Body>
              </View>
            ))}
          </View>
        </Card>

        <Body tone="soft" style={styles.finePrint}>
          This is not a contract. It is what this app does with your position, and
          what it will not do.
        </Body>
      </Page>
    );
  }

  const locationSettled = asked.has('location');

  return (
    <Page
      eyebrow="Three requests"
      title="Only the first one is required."
      lede="You can change any of these later, in the app or in your phone's settings."
      footer={<PrimaryAction label={locationSettled ? 'Done, take me in' : 'Skip for now'} onPress={onDone} />}
    >
      {ASKS.map((item) => {
        const granted = state ? item.granted(state) : false;
        return (
          <Card key={item.key} tone="outline" style={{ gap: space.sm }}>
            <View style={styles.askHead}>
              <Body color={palette.ink} style={{ fontWeight: '700', flex: 1 }}>{item.label}</Body>
              {granted ? <Chip label="allowed" tone="strong" /> : null}
            </View>
            <Body tone="soft" style={styles.askText}>{item.why}</Body>
            <Body tone="soft" style={[styles.askText, { opacity: 0.75 }]}>If you say no: {item.ifDeclined}</Body>
            {granted ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={() => void ask(item)}
                style={({ pressed }) => [styles.askButton, { borderColor: palette.line, opacity: pressed ? 0.7 : 1 }]}
              >
                <Body color={palette.ink} style={{ fontWeight: '600' }}>
                  {asked.has(item.key) ? 'Ask again' : `Allow ${item.label.toLowerCase()}`}
                </Body>
              </Pressable>
            )}
          </Card>
        );
      })}

      {state?.blockedBy.length ? (
        <Card tone="outline" style={{ gap: space.xs }}>
          {state.blockedBy.map((reason) => (
            <Body key={reason} tone="soft" style={styles.askText}>{reason}</Body>
          ))}
        </Card>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  point: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  bullet: { width: 8, height: 8, borderRadius: radius.pill, marginTop: 8 },
  pointText: { flex: 1 },
  finePrint: { fontSize: 15, lineHeight: 21 },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  askText: { fontSize: 15, lineHeight: 21 },
  askButton: {
    minHeight: 48, borderRadius: radius.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md,
  },
  continue: {
    minHeight: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2,
  },
});
