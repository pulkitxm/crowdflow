
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, View } from 'react-native';
import type { RaceSummary, VenueGeometry } from '@crowdflow/contracts/wire';

import { MapView } from '../circuits/MapView';
import { circuitCapabilityChip, circuitCapabilityNotice, supportsOperationalGuidance, type CircuitChoice, type CircuitSource } from '../circuits/registry';
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
  circuits: CircuitSource;
  selectedId?: string | null;
  onPick: (race: SelectedRace) => void;
  onBack: () => void;
}) {
  const palette = usePalette();
  const [races, setRaces] = useState<RaceSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<RaceSummary | null>(null);
  const [circuitChoices, setCircuitChoices] = useState<CircuitChoice[]>([]);
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

  useEffect(() => {
    let alive = true;
    circuits.list()
      .then((list) => { if (alive) setCircuitChoices(list); })
      .catch(() => { if (alive) setCircuitChoices([]); });
    return () => { alive = false; };
  }, [circuits]);

  const sections = useMemo(
    () => byMonth(races ?? []).map((group) => ({ title: group.month, data: group.races })),
    [races],
  );
  const circuitById = useMemo(() => new Map(circuitChoices.map((circuit) => [circuit.id, circuit])), [circuitChoices]);

  const active = chosen ?? races?.find((race) => race.id === selectedId) ?? null;
  const activeCircuit = active ? circuitById.get(active.circuit_id) ?? null : null;
  const activeCapability = geometry?.pack.capability ?? activeCircuit?.capability;
  const activeLayout = geometry?.pack.layout_id ?? activeCircuit?.layout_id;
  const guidanceBlocked = !!active?.has_map && !circuits.demo && (!activeCapability || !supportsOperationalGuidance(activeCapability));

  useEffect(() => {
    if (!active?.has_map) { setGeometry(null); setLoadingMap(false); return; }
    let alive = true;
    setGeometry(null);
    setLoadingMap(true);
    circuits.geometry(active.circuit_id)
      .then((next) => { if (alive) { setGeometry(next); setLoadingMap(false); } })
      .catch(() => {
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
          {}
          <Body tone="soft" style={styles.footnote}>
            {active.has_map && activeCapability && activeLayout
              ? `${active.locality}: ${circuitCapabilityNotice({ capability: activeCapability, layout_id: activeLayout })}`
              : active.has_map
              ? `${active.locality} is mapped. You will get walking guidance and the live crowd picture.`
              : `${active.locality} has no venue map yet, so you will get the timetable but no walking guidance.`}
          </Body>
          <PrimaryAction
            label={guidanceBlocked ? 'Operational guidance unavailable' : activeCapability === 'synthetic_simulation' ? 'Continue in demo mode' : `Continue with ${active.name}`}
            onPress={() => onPick(toSelected(active))}
            disabled={guidanceBlocked}
          />
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
                  {item.has_map ? <Chip label={mappedChipLabel(circuitById, item.circuit_id)} tone="strong" /> : <Chip label="no map" />}
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

function mappedChipLabel(circuits: Map<string, CircuitChoice>, circuitId: string): string {
  const circuit = circuits.get(circuitId);
  return circuit ? circuitCapabilityChip(circuit.capability) : 'mapped';
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
