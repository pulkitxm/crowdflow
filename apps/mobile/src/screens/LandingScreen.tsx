import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SensingStatus } from '@crowdflow/contracts';

import { countdown, nextSession, venueClock, venueDay, weekendRange } from '../events/format';
import type { SelectedRace } from '../events/selection';
import { space } from '../theme';
import { Body, Card, Display, PrimaryAction, SecondaryAction, Title } from '../ui/atoms';
import { Chip, MetaRow, Page, RoundBadge, Section } from '../ui/layout';
import { useMetrics, useStep } from '../ui/responsive';
import { usePalette } from '../ui/theme';

export function LandingScreen({
  race,
  personId,
  sensing,
  onSelect,
  onContinue,
  onSensing,
}: {
  race: SelectedRace | null;
  personId: number;
  sensing: SensingStatus | null;
  onSelect: () => void;
  onContinue: () => void;
  onSensing: () => void;
}) {
  const palette = usePalette();
  const step = useStep();
  const { tiny } = useMetrics();
  const now = useMemo(() => new Date(), []);

  if (!race) {
    return (
      <Page
        eyebrow="CrowdFlow"
        title="Which race are you going to?"
        lede="Pick your race and we will guide you through the weekend."
        footer={<PrimaryAction label="Choose your race" onPress={onSelect} />}
      >
        <SharingLine sensing={sensing} onPress={onSensing} />
        <PersonLine personId={personId} />
      </Page>
    );
  }

  const upcoming = nextSession(race, now);
  const when = countdown(race, now);

  return (
    <Page
      eyebrow="Your race"
      footer={
        race.has_map ? (
          <PrimaryAction label="Start walking guidance" onPress={onContinue} />
        ) : (
          <View style={{ gap: step(space.sm) }}>
            <Body tone="soft" style={styles.note}>
              We have the timetable for {race.locality}, but not a venue map yet — so there is no
              walking guidance for this round.
            </Body>
            <PrimaryAction label="Choose a different race" onPress={onSelect} />
          </View>
        )
      }
    >
      <View style={{ gap: step(space.md) }}>
        <View style={[styles.heroHead, { gap: step(space.md) }]}>
          <RoundBadge round={race.round} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Title numberOfLines={2} style={{ fontSize: tiny ? 24 : 26, lineHeight: tiny ? 28 : 32 }}>
              {race.name}
            </Title>
            <Body tone="soft" numberOfLines={1}>
              {race.locality}, {race.country}
            </Body>
          </View>
        </View>
        <View style={[styles.chips, { gap: step(space.sm) }]}>
          <Chip label={when} tone={when === 'Happening now' ? 'strong' : 'quiet'} />
          {race.has_map ? null : <Chip label="no venue map" tone="warn" />}
        </View>
      </View>

      {upcoming ? (
        <Section label="Next session">
          <Card style={{ gap: step(space.xs) }}>
            <Body color={palette.ink} style={{ fontWeight: '700' }} numberOfLines={2}>
              {upcoming.name ?? upcoming.kind}
            </Body>
            <Display
              numberOfLines={1}
              shrinkToFit
              style={{ fontSize: 46, lineHeight: 50, fontVariant: ['tabular-nums'] }}
            >
              {venueClock(upcoming.start, race.utc_offset)}
            </Display>
            <Body tone="soft">
              {venueDay(upcoming.start, race.utc_offset)}
              {race.utc_offset ? ` · circuit time (UTC${race.utc_offset})` : ''}
            </Body>
          </Card>
        </Section>
      ) : null}

      <Section label="The weekend">
        <Card tone="outline" style={{ gap: step(space.md) }}>
          <MetaRow label="Dates" value={weekendRange(race)} emphasis />
          <MetaRow label="Sessions" value={`${race.sessions?.length ?? 0}`} />
          <MetaRow label="Round" value={`${race.round} of the ${race.season} season`} />
        </Card>
      </Section>

      <SecondaryAction label="Change race" onPress={onSelect} />

      <View style={{ gap: step(space.xs) }}>
        <SharingLine sensing={sensing} onPress={onSensing} />
        <PersonLine personId={personId} />
      </View>
    </Page>
  );
}

function PersonLine({ personId }: { personId: number }) {
  return (
    <Body tone="soft" style={styles.note}>
      You are pass #{personId} on this circuit.
    </Body>
  );
}

function SharingLine({ sensing, onPress }: { sensing: SensingStatus | null; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Body color={palette.ink} style={[styles.note, { textDecorationLine: 'underline' }]}>
        {sensing?.active
          ? 'Sharing your position — tap to see or stop'
          : 'Not sharing your position — tap for details'}
      </Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heroHead: { flexDirection: 'row', alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  link: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  note: { fontSize: 15, lineHeight: 22 },
});
