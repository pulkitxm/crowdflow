/**
 * The answer to "what is this app doing with my phone right now".
 *
 * Not a settings page with a switch on it. The switch is here, but the screen
 * exists so that every claim the disclosure made is checkable from it: which
 * radio is placing you, how well, how old that reading is, how many samples are
 * waiting, and how long until the label your phone reports under is thrown away.
 * An app that says "we anonymise your data" and shows nothing is asking to be
 * trusted. An app that shows a countdown to the next identifier rotation is
 * showing its work.
 *
 * It is also the support screen. Every reason a rung of the ladder is unavailable
 * arrives here as a sentence somebody can act on — "Bluetooth is switched off",
 * not an adapter state enum — because the person holding the phone is the only
 * one who can fix most of them.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PositionSource, SensingStatus } from '@crowdflow/contracts';

import { radius, space } from '../theme';
import { Body, Card } from '../ui/atoms';
import { Chip, MetaRow, Page, Section } from '../ui/layout';
import { usePalette } from '../ui/theme';

const RADIO_WORD: Record<PositionSource, string> = {
  wifi: 'Wi-Fi',
  ble: 'Bluetooth',
  gnss: 'GPS',
  fused: 'combined',
  // Named honestly on the one screen where the distinction matters: this is the
  // last known position carried forward, not a fresh reading.
  dead_reckoning: 'last known position',
};

export interface SensingSettingsProps {
  status: SensingStatus;
  sharing: boolean;
  /** Seconds until the reporting label is replaced. */
  pseudonymExpiresIn: number;
  survey: { anchors: number; wifi: number; ble: number; surveyedAt: string | null };
  onSharingChange: (sharing: boolean) => void;
  onWithdraw: () => void;
  onBack: () => void;
}

export function SensingSettings({
  status, sharing, pseudonymExpiresIn, survey, onSharingChange, onWithdraw, onBack,
}: SensingSettingsProps) {
  const fix = status.last_fix ?? null;
  const ageS = fix ? Math.max(0, Math.round(Date.now() / 1000 - fix.timestamp)) : null;

  return (
    <Page
      eyebrow="Your position"
      title={sharing ? (status.active ? 'Sharing, and helping.' : 'Sharing is on, but nothing is reporting.') : 'Not sharing.'}
      onBack={onBack}
    >
      <View style={styles.chips}>
        <Chip label={sharing && status.active ? 'live' : 'paused'} tone={sharing && status.active ? 'strong' : 'warn'} />
        {status.using ? <Chip label={`via ${RADIO_WORD[status.using]}`} /> : null}
      </View>

      <Card tone="outline" style={{ gap: space.md }}>
        <MetaRow label="Placed by" value={status.using ? RADIO_WORD[status.using] : 'nothing right now'} emphasis />
        <MetaRow
          label="How precisely"
          // Metres, rounded, with the age beside it. A precision figure with no
          // age is a photograph presented as a window.
          value={fix ? `about ${Math.round(fix.accuracy_m)} m${ageS == null ? '' : `, ${ageS}s ago`}` : '—'}
        />
        <MetaRow
          label="Radios in use"
          value={status.available?.length ? status.available.map((source) => RADIO_WORD[source]).join(', ') : 'none'}
        />
        <MetaRow label="Waiting to send" value={`${status.queued} ${status.queued === 1 ? 'reading' : 'readings'}`} />
        <MetaRow label="Label changes in" value={formatDuration(pseudonymExpiresIn)} />
      </Card>

      {status.blocked_by?.length ? (
        <Section label="Why some of this is off">
          <Card tone="outline" style={{ gap: space.sm }}>
            {status.blocked_by.map((reason) => (
              <Body key={reason} tone="soft" style={styles.small}>{reason}</Body>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section label="This circuit's radio map">
        <Card tone="outline" style={{ gap: space.sm }}>
          <Body tone="soft" style={styles.small}>
            {survey.anchors === 0
              ? 'No Wi-Fi or Bluetooth map here, so your phone is using GPS alone.'
              : `${survey.wifi} Wi-Fi points and ${survey.ble} beacons are mapped.`}
          </Body>
          {survey.anchors > 0 && !survey.surveyedAt ? (
            // The distinction the whole provenance system exists for, said out
            // loud: these positions are planned, not measured, and the fixes
            // built on them inherit that.
            <Body tone="soft" style={styles.small}>
              These positions are planned rather than surveyed, so positions from them are approximate.
            </Body>
          ) : null}
        </Card>
      </Section>

      <Choice
        label={sharing ? 'Stop sharing my position' : 'Start sharing again'}
        note={sharing
          ? 'Reporting stops immediately. Guidance keeps working from your own phone.'
          : 'Reporting starts again from your current position.'}
        onPress={() => onSharingChange(!sharing)}
      />

      <Choice
        label="Withdraw what I agreed to"
        note="Stops reporting and forgets your agreement. You will be asked again next time."
        onPress={onWithdraw}
      />
    </Page>
  );
}

/** A destructive-ish choice with its consequence inside the target, so the price
 *  is readable before the finger lands rather than in a dialog afterwards. */
function Choice({ label, note, onPress }: { label: string; note: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${note}`}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, { borderColor: palette.line, opacity: pressed ? 0.7 : 1 }]}
    >
      <Body color={palette.ink} style={{ fontWeight: '700' }}>{label}</Body>
      <Body tone="soft" style={styles.small}>{note}</Body>
    </Pressable>
  );
}

function formatDuration(seconds: number): string {
  if (!(seconds > 0)) return 'any moment';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${Math.round(seconds)}s`;
  return `${minutes} min`;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  small: { fontSize: 15, lineHeight: 21 },
  choice: {
    borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4,
    minHeight: 64, justifyContent: 'center',
  },
});
