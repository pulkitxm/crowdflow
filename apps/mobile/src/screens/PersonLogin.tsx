import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { radius, space, type } from '../theme';
import { Body, Card, PrimaryAction } from '../ui/atoms';
import { Chip, Page } from '../ui/layout';
import { usePalette } from '../ui/theme';

export function PersonLogin({ onLogin }: { onLogin: (personId: number) => Promise<void> }) {
  const palette = usePalette();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const personId = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(personId) || personId < 1) {
      setProblem('Enter a positive whole number, such as 1 or 2048.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onLogin(personId);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The circuit could not be reached.');
      setBusy(false);
    }
  };

  return (
    <Page
      eyebrow="CrowdFlow access"
      title="Enter your person ID."
      lede="For this local pilot, your event pass is a sequential number."
      footer={<PrimaryAction label={busy ? 'Entering circuit...' : 'Enter circuit'} onPress={busy ? undefined : () => void submit()} />}
    >
      <Card style={styles.card}>
        <View style={styles.labelRow}>
          <Body tone="soft" style={styles.label}>PERSON ID</Body>
          <Chip label="pilot access" />
        </View>
        <View style={[styles.field, { backgroundColor: palette.paper, borderColor: problem ? palette.backingUp.edge : palette.line }]}>
          <Body tone="soft" style={styles.prefix}>#</Body>
          <TextInput
            accessibilityLabel="Person ID"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            editable={!busy}
            keyboardType="number-pad"
            maxLength={12}
            onChangeText={(next) => { setValue(next.replace(/\s/g, '')); setProblem(null); }}
            onSubmitEditing={() => void submit()}
            placeholder="1"
            placeholderTextColor={palette.inkSoft}
            returnKeyType="done"
            style={[styles.input, { color: palette.ink }]}
            value={value}
          />
        </View>
        {problem ? <Body color={palette.backingUp.text} style={styles.problem}>{problem}</Body> : null}
      </Card>

      <Card tone="outline" style={styles.explainer}>
        <Body color={palette.ink} style={styles.explainerTitle}>One ID, one live position</Body>
        <Body tone="soft" style={styles.explainerCopy}>
          After you approve location access, the latest position from GPS, Wi-Fi, or Bluetooth will appear on the circuit dashboard.
        </Body>
      </Card>
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  label: { fontSize: type.micro.size, lineHeight: type.micro.lineHeight, fontWeight: '700', letterSpacing: 0.8 },
  field: {
    minHeight: 84, borderRadius: radius.md, borderWidth: 2,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md,
  },
  prefix: { fontSize: 34, lineHeight: 42, fontWeight: '600', marginRight: space.sm },
  input: { flex: 1, minWidth: 0, fontSize: 38, lineHeight: 46, fontWeight: '700', paddingVertical: space.sm },
  problem: { fontSize: 15, lineHeight: 21 },
  explainer: { gap: space.xs },
  explainerTitle: { fontWeight: '700' },
  explainerCopy: { fontSize: 15, lineHeight: 21 },
});
