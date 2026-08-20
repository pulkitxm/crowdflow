
import { describe, expect, it } from 'vitest';

import { CONTRAST_BODY, CONTRAST_LARGE, MIN_TOUCH, PRIMARY_ACTION_HEIGHT, palettes, type Palette } from './theme';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const themes = Object.entries(palettes) as [string, Palette][];

describe.each(themes)('%s palette', (_name, palette) => {
  it('carries body text well past the 4.5:1 floor', () => {
    expect(ratio(palette.ink, palette.paper)).toBeGreaterThanOrEqual(12);
    expect(ratio(palette.ink, palette.surface)).toBeGreaterThanOrEqual(10);
  });

  it('keeps secondary text readable rather than decorative', () => {
    expect(ratio(palette.inkSoft, palette.paper)).toBeGreaterThanOrEqual(CONTRAST_BODY);
    expect(ratio(palette.inkSoft, palette.surface)).toBeGreaterThanOrEqual(CONTRAST_BODY);
  });

  it('keeps the primary action legible', () => {
    expect(ratio(palette.actionText, palette.actionFill)).toBeGreaterThanOrEqual(CONTRAST_BODY);
  });

  it.each([
    ['clear', palette.clear],
    ['slowing', palette.slowing],
    ['backing up', palette.backingUp],
    ['unknown', palette.unknown],
  ])('states %s in text that meets contrast on its own fill', (_status, colors) => {
    expect(ratio(colors.text, colors.fill)).toBeGreaterThanOrEqual(CONTRAST_BODY);
    expect(ratio(colors.edge, colors.fill)).toBeGreaterThanOrEqual(CONTRAST_LARGE);
  });

  it('separates the status fills from the page so a pill reads as an object', () => {
    for (const colors of [palette.clear, palette.slowing, palette.backingUp, palette.unknown]) {
      expect(ratio(colors.edge, palette.paper)).toBeGreaterThanOrEqual(CONTRAST_LARGE);
    }
  });

  it('does not rely on the three states being distinguishable by colour alone', () => {
    const fills = [palette.clear.fill, palette.slowing.fill, palette.backingUp.fill];
    for (const fill of fills) {
      expect(ratio(fill, palette.paper)).toBeLessThan(CONTRAST_LARGE);
    }
  });
});

describe('touch targets', () => {
  it('meets the largest of the published minimums', () => {
    expect(MIN_TOUCH).toBeGreaterThanOrEqual(48);
    expect(PRIMARY_ACTION_HEIGHT).toBeGreaterThan(MIN_TOUCH);
  });
});
