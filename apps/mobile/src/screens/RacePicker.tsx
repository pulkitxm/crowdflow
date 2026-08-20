/**
 * The race picker: the season, by month, one race per row.
 *
 * This replaced a circuit picker, and the change is the point. A list of
 * twenty-three lowercase circuit ids asks somebody to recognise the venue behind
 * the name on their ticket — which is the data model's problem, not theirs.
 * People hold tickets to the British Grand Prix on the fifth of July.
 *
 * Three things are on every row and each earns its place:
 *
 *   THE ROUND NUMBER, because "round nine" is how the sport is discussed and
 *   everybody at a circuit already reads it. It is also the fixed-width slot
 *   that keeps the titles aligned down the list — a ragged left edge is most of
 *   what makes a list look like dumped data rather than a table of it.
 *
 *   THE WEEKEND, first session to last, not just race day. A single date invites
 *   somebody to arrive on Sunday holding a Friday ticket.
 *
 *   WHETHER IT CAN BE GUIDED. Most rounds have no committed circuit pack, so the
 *   app can name the race and give the timetable but cannot route anybody through
 *   the venue. Those rows are still listed, still selectable, and say what they
 *   will and will not do — a row greyed out with no reason is a dead end, and a
 *   list quietly filtered down to the one usable entry hides the gap.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import type { RaceSummary, VenueGeometry } from '@crowdflow/api/wire';

import { MapView } from '../circuits/MapView';
import type { CircuitSource } from '../circuits/registry';
import { byMonth, countdown, weekendRange } from '../events/format';
import type { RaceSource } from '../events/registry';
import { toSelected, type SelectedRace } from '../events/selection';
import { space } from '../theme';
import { Body, Card, PrimaryAction } from '../ui/atoms';
import { Chip, ListRow, Page, RoundBadge } from '../ui/layout';
import { usePalette } from '../ui/theme';

export function RacePicker({
  source,
  circuits,
  selectedId,
  onPick,
  onBack,
}: {
  source: RaceSource;
  /**
   * Where the venue drawing comes from, for the confirmation preview.
   *
   * The map is the answer to a question a name cannot settle: is this the place
   * on my ticket. Twenty-three rounds share a naming convention and a person
   * scanning quickly can pick the wrong one; the outline of the circuit is
   * instantly recognisable in a way "Round 9" is not.
   */
  circuits: CircuitSource;
  selectedId?: string | null;
  onPick: (race: SelectedRace) => void;
  onBack: () => void;
}) {
  const palette = usePalette();
  const [races, setRaces] = useState<RaceSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<RaceSummary | null>(null);
  const [geometry, setGeometry] = useState<VenueGeometry | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    let alive = true;
    source.list()
      .then((list) => { if (alive) { setRaces(list); setProblem(null); } })
      .catch((error) => { if (alive) setProblem(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [source]);

  const sections = useMemo(
    () => byMonth(races ?? []).map((group) => ({ title: group.month, data: group.races })),
    [races],
  );

  const active = chosen ?? races?.find((race) => race.id === selectedId) ?? null;

  // Only fetch a drawing for a round that has one. An unmapped round has no pack
  // to fetch, and asking would produce a 404 the picker would have to explain.
  useEffect(() => {
    if (!active?.has_map) { setGeometry(null); setLoadingMap(false); return; }
    let alive = true;
    setGeometry(null);
    setLoadingMap(true);
    circuits.geometry(active.circuit_id)
      .then((next) => { if (alive) { setGeometry(next); setLoadingMap(false); } })
      .catch(() => {
        // A missing drawing is not a reason to block the choice — the timetable
        // and the guidance do not depend on it. The preview simply does not
        // appear, and the row already said the round is mapped.
        if (alive) { setGeometry(null); setLoadingMap(false); }
      });
    return () => { alive = false; };
  }, [circuits, active?.circuit_id, active?.has_map]);

  return (
    <Page
      eyebrow={`${races?.[0]?.season ?? ''} season`.trim()}
      title="Which race are you going to?"
      lede={source.demo ? 'Demo build — the bundled calendar.' : undefined}
      onBack={onBack}
      scroll={false}
      footer={active ? (
        <View style={{ gap: space.sm }}>
          {active.has_map ? (
            <View style={styles.preview}>
              {loadingMap ? <ActivityIndicator color={palette.ink} /> : geometry ? <MapView geometry={geometry} /> : null}
            </View>
          ) : null}
          {/* The consequence of the choice, stated before the button rather than
              discovered after it. */}
          <Body tone="soft" style={styles.footnote}>
            {active.has_map
              ? `${active.locality} is mapped — you will get walking guidance and the live crowd picture.`
              : `${active.locality} has no venue map yet, so you will get the timetable but no walking guidance.`}
          </Body>
          <PrimaryAction label={`Continue with ${active.name}`} onPress={() => onPick(toSelected(active))} />
        </View>
      ) : null}
    >
      {races === null ? (
        <View style={styles.centre}>
          {problem ? (
            <Body tone="soft" style={{ textAlign: 'center' }}>
              The season calendar could not be loaded. Check the connection and try again.
            </Body>
          ) : (
            <ActivityIndicator color={palette.ink} />
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <View style={[styles.month, { backgroundColor: palette.paper, borderBottomColor: palette.line }]}>
              <Body tone="soft" style={styles.monthLabel}>{section.title.toUpperCase()}</Body>
            </View>
          )}
          renderItem={({ item }) => (
            <ListRow
              lead={<RoundBadge round={item.round} />}
              title={item.name}
              subtitle={`${item.locality}, ${item.country} · ${weekendRange(item)}`}
              selected={active?.id === item.id}
              onPress={() => setChosen(item)}
              trailing={
                <>
                  <Body tone="soft" style={styles.when}>{countdown(item, now)}</Body>
                  {item.has_map ? <Chip label="mapped" tone="strong" /> : <Chip label="no map" />}
                </>
              }
            />
          )}
          ListFooterComponent={
            <Card tone="outline" style={{ marginTop: space.md }}>
              <Body tone="soft" style={styles.footnote}>
                {racesMapped(races)} of {races.length} venues are mapped. The rest are on the
                calendar and will be guided once their venue data is surveyed.
              </Body>
            </Card>
          }
        />
      )}
    </Page>
  );
}

function racesMapped(races: RaceSummary[]): number {
  return races.filter((race) => race.has_map).length;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  month: {
    paddingTop: space.md,
    paddingBottom: space.sm,
    marginBottom: space.xs,
    borderBottomWidth: 1,
  },
  monthLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 1 },
  when: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  preview: { minHeight: 40, justifyContent: 'center' },
  footnote: { fontSize: 15, lineHeight: 21 },
});
