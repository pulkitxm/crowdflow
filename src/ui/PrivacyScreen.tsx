import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { collectedData, neverCollectedData } from '../core/privacy';
import { colors } from './theme';

export function PrivacyScreen({ onBack }: { onBack(): void }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.header}><Text style={styles.title}>PRIVATE BY DESIGN</Text>
      <Pressable style={styles.done} onPress={onBack}><Text style={styles.doneText}>Done</Text></Pressable></View>
    <Text style={styles.intro}>A phone is a temporary crowd node—not a person identity. The random ID rotates every 15 minutes and is never saved.</Text>
    <PrivacyCard title="SHARED" items={[...collectedData]} color={colors.moss} marker="●" />
    <PrivacyCard title="NEVER COLLECTED" items={[...neverCollectedData]} color={colors.signal} marker="×" />
    <Text style={styles.note}>Raw peer handles stay inside the Bluetooth/Wi-Fi drivers. The app sends venue-relative metres—not geographic coordinates—to the mesh or backend.</Text>
  </ScrollView>;
}
function PrivacyCard({ title, items, color, marker }: { title: string; items: string[]; color: string; marker: string }) {
  return <View style={styles.card}><Text style={[styles.eyebrow, { color }]}>{title}</Text>
    {items.map((item) => <View key={item} style={styles.item}><Text style={[styles.marker, { color }]}>{marker}</Text><Text style={styles.itemText}>{item}</Text></View>)}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream }, content: { padding: 20, gap: 15 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 }, title: { flex: 1, fontSize: 25, fontWeight: '900', color: colors.ink },
  done: { borderColor: colors.moss, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 }, doneText: { color: colors.moss, fontWeight: '800' },
  intro: { color: colors.muted, fontSize: 16, lineHeight: 23, marginBottom: 5 },
  card: { backgroundColor: colors.paper, borderRadius: 20, padding: 18 }, eyebrow: { fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  item: { flexDirection: 'row', paddingVertical: 6 }, marker: { width: 24, fontWeight: '900' }, itemText: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
