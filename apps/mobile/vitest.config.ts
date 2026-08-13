import { defineConfig } from 'vitest/config';
/**
 * The suite deliberately covers only pure modules — formatting, the safety gate,
 * the severity reduction, the palette and the vocabulary. Rendering React Native
 * components under Node buys assertions about `<View>` trees that break on every
 * layout change and prove nothing about a screen read in sunlight; the screens
 * are kept thin enough that all their judgement lives in the modules below.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'modules/**/*.test.ts'],
    environment: 'node',
  },
});
