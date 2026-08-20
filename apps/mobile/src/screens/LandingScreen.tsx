/**
 * The front page: which race, and what is happening at it.
 *
 * It used to ask for a circuit, and that was the wrong question. Nobody holds a
 * ticket to a circuit id — they hold one to the British Grand Prix on the fifth
 * of July — so the page now leads with the race and treats the venue as a
 * property of it.
 *
 * The order down the screen is a priority ordering, not a layout:
 *
 *   THE RACE, as its own block, with the round number the sport actually uses.
 *   THE NEXT SESSION, in venue time, because at a circuit that is the only
 *   question — and it disappears once the weekend is over rather than sitting
 *   there as a stale fact.
 *   WHAT THE APP CAN DO HERE, before the button rather than after it. Most
 *   rounds have no venue map, and "Continue" leading to a screen that cannot
 *   guide you is the kind of dead end that loses a user for good.
 *   WHETHER THE PHONE IS SHARING, last and always visible.
 *
 * Times are rendered in the VENUE's offset and labelled as such. Every timestamp
 * in this system is UTC; a phone being used to plan a trip from another country
 * is not on venue time, and that is exactly when a start time gets misread by an
 * hour.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SensingStatus } from '@crowdflow/contracts';

import { countdown, nextSession, venueClock, venueDay, weekendRange } from '../events/format';
import type { SelectedRace } from '../events/selection';
import { space } from '../theme';
import { Body, Card, Display, PrimaryAction, Title } from '../ui/atoms';
import { Chip, MetaRow, Page, RoundBadge, Section } from '../ui/layout';
import { usePalette } from '../ui/theme';

export function LandingScreen({
  race,
  sensing,
  onSelect,
  onContinue,
  onSensing,
}: {
  race: SelectedRace | null;
  sensing: SensingStatus | null;
  onSelect: () => void;
  onContinue: () => void;
  onSensing: () => void;
}) {
  const palette = usePalette();
  const now = useMemo(() => new Date(), []);

  if (!race) {
    return (
      <Page
        eyebrow="Crowdflow"
        title="Which race are you going to?"
        lede="Pick your race and we will guide you through the weekend — the same live picture the circuit team is watching."
        footer={<PrimaryAction label="Choose your race" onPress={onSelect} />}
      >
        <Card tone="outline">
          <Body tone="soft" style={styles.note}>
            Twenty-three rounds are on the calendar. You only need to tell us which one.
          </Body>
        </Card>
        <SharingLine sensing={sensing} onPress={onSensing} />
      </Page>
    );
  }

  const upcoming = nextSession(race, now);
  const when = countdown(race, now);

  return (
    <Page
      eyebrow="Your race"
      footer={
        race.has_map
          ? <PrimaryAction label="Continue" onPress={onContinue} />
          : (
            // No map, no guidance — and the button says so instead of leading
            // somewhere that cannot answer.
            <View style={{ gap: space.sm }}>
              <Body tone="soft" style={styles.note}>
                We have the timetable for {race.locality}, but not a venue map yet — so there is
                no walking guidance to show for this round.
              </Body>
              <PrimaryAction label="Choose a different race" onPress={onSelect} />
            </View>
          )
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroHead}>
          <RoundBadge round={race.round} />
          <View style={{ flex: 1, gap: 2 }}>
            <Title style={{ fontSize: 26, lineHeight: 32 }}>{race.name}</Title>
            <Body tone="soft">{race.locality}, {race.country}</Body>
          </View>
        </View>
        <View style={styles.chips}>
          <Chip label={when} tone={when === 'Happening now' ? 'strong' : 'quiet'} />
          {race.has_map ? <Chip label="venue mapped" /> : <Chip label="no venue map" tone="warn" />}
        </View>
      </View>

      {upcoming ? (
        <Section label="Next session">
          <Card tone="outline" style={{ gap: space.xs }}>
            <Body color={palette.ink} style={{ fontWeight: '700' }}>{upcoming.name ?? upcoming.kind}</Body>
            <Display style={{ fontSize: 44, lineHeight: 48 }}>
              {venueClock(upcoming.start, race.utc_offset)}
            </Display>
            <Body tone="soft">
              {venueDay(upcoming.start, race.utc_offset)}
              {race.utc_offset ? ` · local time at the circuit (UTC${race.utc_offset})` : ''}
            </Body>
          </Card>
        </Section>
      ) : null}

      <Section label="The weekend">
        <Card tone="outline" style={{ gap: space.md }}>
          <MetaRow label="Dates" value={weekendRange(race)} emphasis />
          <MetaRow label="Sessions" value={`${race.sessions?.length ?? 0}`} />
          <MetaRow label="Round" value={`${race.round} of the ${race.season} season`} />
        </Card>
      </Section>

      <Pressable accessibilityRole="button" onPress={onSelect} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}>
        <Body color={palette.ink} style={{ textDecorationLine: 'underline' }}>Change race</Body>
      </Pressable>

      <SharingLine sensing={sensing} onPress={onSensing} />
    </Page>
  );
}

/**
 * Whether the phone is helping, in one line, always visible.
 *
 * Never behind a settings icon. Somebody who agreed to share their position is
 * entitled to see at a glance whether it is happening, and to stop it in one tap.
 */
function SharingLine({ sensing, onPress }: { sensing: SensingStatus | null; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}>
      <Body tone="soft" style={styles.note}>
        {sensing?.active
          ? 'Sharing your position to help the crowd picture — tap to see or stop'
          : 'Not sharing your position — tap for details'}
      </Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md },
  heroHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  link: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  note: { fontSize: 15, lineHeight: 21 },
});
