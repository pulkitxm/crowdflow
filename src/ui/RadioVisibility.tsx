import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TransportStatus } from '../core/contracts';
import { colors } from './theme';

export function RadioVisibility({ statuses }: { statuses: TransportStatus[] }) {
  const bluetooth = statuses.find((status) => status.kind === 'bluetooth');
  const lan = statuses.find((status) => status.kind === 'wifi-lan');
  const direct = statuses.find((status) => status.kind === 'wifi-direct');
  const wifi = lan?.running ? lan : direct?.running ? direct : lan ?? direct;
  return <View style={styles.card}>
    <Text style={styles.eyebrow}>VISIBLE NEARBY</Text>
    <RadioRow label="Bluetooth" status={bluetooth} />
    <View style={styles.divider} />
    <RadioRow label="Wi-Fi" status={wifi} extra={direct?.running && lan?.running ? ' + Direct' : ''} />
  </View>;
}

function RadioRow({ label, status, extra = '' }: { label: string; status?: TransportStatus; extra?: string }) {
  return <View style={styles.row}>
    <View style={[styles.dot, { backgroundColor: status?.running && status.discoverable ? colors.lime : colors.signal }]} />
    <View style={{ flex: 1 }}><Text style={styles.label}>{label}{extra}</Text>
      <Text style={styles.detail} numberOfLines={1}>{status?.detail ?? 'Waiting for runtime'}</Text></View>
    <Text style={styles.count}>{status?.peerCount ?? 0}</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.paper, borderRadius: 18, padding: 16 },
  eyebrow: { color: colors.muted, fontWeight: '900', fontSize: 11, letterSpacing: 1, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 10 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  detail: { color: colors.muted, fontSize: 12, marginTop: 2 },
  count: { color: colors.moss, fontWeight: '900', fontSize: 16 },
  divider: { height: 1, backgroundColor: colors.cream, marginVertical: 10 },
});
