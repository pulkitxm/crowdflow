import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { fonts, radius, space } from '../theme';
import { Body, Card, PrimaryAction } from '../ui/atoms';
import { Page } from '../ui/layout';
import { useMetrics, useStep } from '../ui/responsive';
import { usePalette } from '../ui/theme';

export function PersonLogin({ onLogin }: { onLogin: (personId: number) => Promise<void> }) {
  const palette = usePalette();
  const step = useStep();
  const { typeScale, tiny } = useMetrics();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const personId = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(personId) || personId < 1) {
      setProblem('Enter a whole number, such as 1 or 2048.');
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

  const fieldSize = Math.round((tiny ? 32 : 38) * typeScale);

  return (
    <Page
      eyebrow="CrowdFlow"
      title="What is your pass number?"
      lede="It is printed on your event pass. For this pilot it is a plain number."
      footer={
        <PrimaryAction
          label={busy ? 'Entering the circuit…' : 'Enter the circuit'}
          state={busy ? 'busy' : 'ready'}
          onPress={() => void submit()}
        />
      }
    >
      <Card style={{ gap: step(space.md) }}>
        <View
          style={[
            styles.field,
            {
              backgroundColor: palette.paper,
              borderColor: problem ? palette.backingUp.edge : palette.line,
              minHeight: Math.round(84 * typeScale),
            },
          ]}
        >
          <Body
            tone="soft"
            style={{ fontSize: fieldSize, lineHeight: Math.round(fieldSize * 1.15), marginRight: space.sm }}
          >
            #
          </Body>
          <TextInput
            accessibilityLabel="Pass number"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            editable={!busy}
            keyboardType="number-pad"
            maxLength={12}
            onChangeText={(next) => {
              setValue(next.replace(/\s/g, ''));
              setProblem(null);
            }}
            onSubmitEditing={() => void submit()}
            placeholder="1"
            placeholderTextColor={palette.inkSoft}
            returnKeyType="done"
            style={[
              styles.input,
              {
                color: palette.ink,
                fontFamily: fonts.displayBold,
                fontSize: fieldSize,
                lineHeight: Math.round(fieldSize * 1.2),
              },
            ]}
            value={value}
          />
        </View>
        {problem ? (
          <Body color={palette.backingUp.text} style={styles.problem}>
            {problem}
          </Body>
        ) : null}
      </Card>

      <Body tone="soft" style={styles.footnote}>
        Your number is what links you to the live circuit picture. Nothing else about you is asked
        for.
      </Body>
    </Page>
  );
}

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.md,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
  },
  input: { flex: 1, minWidth: 0, paddingVertical: space.sm },
  problem: { fontSize: 15, lineHeight: 22 },
  footnote: { fontSize: 15, lineHeight: 22 },
});
