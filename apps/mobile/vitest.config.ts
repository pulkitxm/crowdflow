import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The suite deliberately covers only pure modules — formatting, the safety gate,
 * the severity reduction, the palette and the vocabulary. Rendering React Native
 * components under Node buys assertions about `<View>` trees that break on every
 * layout change and prove nothing about a screen read in sunlight; the screens
 * are kept thin enough that all their judgement lives in the modules below.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@contracts': path.resolve(__dirname, '../../packages/contracts/ts/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
