import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RuntimeState } from '../runtime/runtimeState';
import type { VenueGraph } from '../venue/venueGraph';
import { ConnectionPill } from './ConnectionPill';
import { RadioVisibility } from './RadioVisibility';
import { colors } from './theme';
import { VenueMap } from './VenueMap';

interface Props {
  graph: VenueGraph; state: RuntimeState; onDebug(): void; onPrivacy(): void; onStart(): void;
}
export function HomeScreen({ graph, state, onDebug, onPrivacy, onStart }: Props) {
  const rerouting = Boolean(state.guidance?.command);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.header}>
      <Pressable onLongPress={onDebug} delayLongPress={500}>
        <Text style={styles.logo}>CROWDFLOW</Text><Text style={styles.subtitle}>LOCAL MESH GUIDANCE</Text>
      </Pressable>
      <ConnectionPill state={state.connectivity} />
    </View>
    <VenueMap graph={graph} position={state.position} route={state.route}
      congestedZone={state.guidance?.command?.avoid[0]} />
    <View style={[styles.guidance, rerouting && styles.guidanceAlert]}>
      <Text style={[styles.guidanceTitle, rerouting && { color: colors.white }]}>
        {state.guidance?.headline ?? (state.running ? 'Finding the safest route' : 'Start nearby guidance')}
      </Text>
      <Text style={[styles.guidanceDetail, rerouting && { color: colors.lime }]}>
        {state.guidance?.detail ?? (state.running ? 'Waiting for a venue position…' :
          'Works over Bluetooth and Wi-Fi, even when the internet does not.')}
      </Text>
      {!state.running && <Pressable style={styles.button} onPress={onStart}><Text style={styles.buttonText}>Start mesh node</Text></Pressable>}
    </View>
    <RadioVisibility statuses={state.transportStatuses} />
    <View style={styles.metrics}>
      <Text style={styles.metric}>Node {state.nodeId}</Text>
      <Text style={styles.metric}>{state.peers.length} nearby · {state.localDensity.toFixed(2)} people/m²</Text>
    </View>
    <Pressable style={styles.outlineButton} onPress={onPrivacy}><Text style={styles.outlineButtonText}>What this phone shares</Text></Pressable>
    {state.lastError && <View style={styles.error}><Text style={styles.errorText}>{state.lastError}</Text></View>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream }, content: { paddingHorizontal: 20, paddingVertical: 16, gap: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  logo: { color: colors.ink, fontWeight: '900', fontSize: 21, letterSpacing: 1.5 },
  subtitle: { color: colors.moss, fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  guidance: { backgroundColor: colors.paper, borderRadius: 20, padding: 20 }, guidanceAlert: { backgroundColor: colors.ink },
  guidanceTitle: { color: colors.ink, fontSize: 22, lineHeight: 27, fontWeight: '900' },
  guidanceDetail: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 6 },
  button: { alignSelf: 'flex-start', backgroundColor: colors.moss, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, marginTop: 16 },
  buttonText: { color: colors.white, fontWeight: '800' },
  metrics: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  metric: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  outlineButton: { borderColor: colors.moss, borderWidth: 1, borderRadius: 13, padding: 13, alignItems: 'center' },
  outlineButtonText: { color: colors.moss, fontWeight: '800' },
  error: { backgroundColor: `${colors.signal}18`, borderRadius: 14, padding: 14 }, errorText: { color: colors.signal, fontWeight: '700' },
});
