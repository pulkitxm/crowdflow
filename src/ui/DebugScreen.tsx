import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { CrowdNodeRuntime } from '../runtime/crowdNodeRuntime';
import type { RuntimeState } from '../runtime/runtimeState';
import { colors } from './theme';

export function DebugScreen({ state, runtime, onBack }: { state: RuntimeState; runtime: CrowdNodeRuntime; onBack(): void }) {
  const [backend, setBackend] = useState(state.backendUrl);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.title}>NODE DIAGNOSTICS</Text><Text style={styles.muted}>Long-press logo to open</Text></View>
      <Pressable style={styles.done} onPress={onBack}><Text style={styles.doneText}>Done</Text></Pressable></View>
    <Value label="Rotating node ID" value={state.nodeId} /><Value label="Active transport" value={state.activeTransport} />
    <Value label="Venue position" value={state.position ? `${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)} m` : 'No fix'} />
    <Value label="Position accuracy" value={state.positionAccuracy ? `±${state.positionAccuracy.toFixed(1)} m` : '—'} />
    <Value label="Current zone" value={state.currentZone ?? '—'} /><Value label="Nearby nodes" value={String(state.peers.length)} />
    <Section title="RADIOS" />
    {state.transportStatuses.map((status) => <View style={styles.radio} key={status.kind}>
      <View style={[styles.dot, { backgroundColor: status.running ? colors.lime : colors.signal }]} />
      <View style={{ flex: 1 }}><Text style={styles.radioName}>{status.name}</Text><Text style={styles.muted}>{status.detail}</Text></View>
      <Text style={styles.radioCount}>{status.peerCount} peers</Text></View>)}
    <Section title="MESSAGES" />
    <Value label="Sent / received / relayed" value={`${state.meshStats.sent} / ${state.meshStats.received} / ${state.meshStats.relayed}`} />
    <Value label="Duplicate / malformed drops" value={`${state.meshStats.duplicateDrops} / ${state.meshStats.malformedDrops}`} />
    <Value label="Uploads / failures / buffered" value={`${state.uploadStats.successes} / ${state.uploadStats.failures} / ${state.uploadStats.buffered}`} />
    <Section title="GATEWAY" />
    <TextInput style={styles.input} value={backend} onChangeText={setBackend} autoCapitalize="none" autoCorrect={false} placeholder="Backend URL" />
    <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={styles.switchTitle}>Relay mesh telemetry</Text><Text style={styles.muted}>Tag peer updates as mesh_relay</Text></View>
      <Switch value={state.gatewayEnabled} onValueChange={(value) => void runtime.setGatewayEnabled(value)} trackColor={{ true: colors.moss }} /></View>
    <Pressable style={styles.save} onPress={() => void runtime.setBackendUrl(backend)}><Text style={styles.saveText}>Save backend</Text></Pressable>
    {__DEV__ && <Pressable style={styles.demo} onPress={() => runtime.injectPosition(48, 105)}><Text style={styles.demoText}>Inject demo position</Text></Pressable>}
  </ScrollView>;
}
function Value({ label, value }: { label: string; value: string }) { return <View style={styles.value}><Text style={styles.valueLabel}>{label}</Text><Text style={styles.valueText}>{value}</Text></View>; }
function Section({ title }: { title: string }) { return <Text style={styles.section}>{title}</Text>; }
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream }, content: { padding: 20, paddingBottom: 50 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 }, title: { color: colors.ink, fontSize: 24, fontWeight: '900' }, muted: { color: colors.muted, fontSize: 12, marginTop: 2 },
  done: { borderWidth: 1, borderColor: colors.moss, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 }, doneText: { color: colors.moss, fontWeight: '800' },
  value: { flexDirection: 'row', paddingVertical: 8, gap: 10 }, valueLabel: { color: colors.muted, flex: 1, fontSize: 13 }, valueText: { color: colors.ink, fontWeight: '800', fontSize: 13, maxWidth: '55%', textAlign: 'right' },
  section: { color: colors.muted, fontWeight: '900', fontSize: 12, letterSpacing: 1, marginTop: 18, marginBottom: 6 },
  radio: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.paper, borderRadius: 14, padding: 14, marginTop: 7 },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 10 }, radioName: { color: colors.ink, fontWeight: '800' }, radioCount: { color: colors.ink, fontSize: 12 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 12, padding: 13, color: colors.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }, switchTitle: { color: colors.ink, fontWeight: '800' },
  save: { backgroundColor: colors.moss, borderRadius: 12, padding: 13, alignItems: 'center' }, saveText: { color: colors.white, fontWeight: '800' },
  demo: { borderWidth: 1, borderColor: colors.amber, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10 }, demoText: { color: colors.amber, fontWeight: '800' },
});
