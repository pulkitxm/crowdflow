/**
 * The palette has to survive being read outdoors.
 *
 * Sunlight legibility is not something any standard specifies, so the test does
 * what can be specified: WCAG 2.2 contrast ratios, computed from the token values
 * themselves rather than eyeballed in a design tool. A palette tweak that looks
 * nicer on a laptop and fails in a car park fails here first.
 */

import { describe, expect, it } from 'vitest';

import { CONTRAST_BODY, CONTRAST_LARGE, MIN_TOUCH, PRIMARY_ACTION_HEIGHT, palettes, type Palette } from './theme';

/** WCAG 2.x relative luminance, sRGB. */
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
    // Soft grey on white is where most designs quietly fail accessibility, and
    // this one is read in glare.
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
    expect(ratio(colors.edge, colors.fill)).toBeGreaterThanOrEqual(1.4);
  });

  it('separates the status fills from the page so a pill reads as an object', () => {
    for (const colors of [palette.clear, palette.slowing, palette.backingUp, palette.unknown]) {
      expect(ratio(colors.edge, palette.paper)).toBeGreaterThanOrEqual(CONTRAST_LARGE - 1.5);
    }
  });

  it('does not rely on the three states being distinguishable by colour alone', () => {
    // Belt and braces for the real defence, which is that every status renders
    // its word: the fills are close enough in luminance that a colour-blind or
    // sun-blinded user gets nothing from them, and that is fine.
    const fills = [palette.clear.fill, palette.slowing.fill, palette.backingUp.fill];
    for (const fill of fills) {
      expect(ratio(fill, palette.paper)).toBeLessThan(CONTRAST_LARGE);
    }
  });
});

describe('touch targets', () => {
  it('meets the largest of the published minimums', () => {
    // Apple 44pt, Material 48dp, WCAG 2.2 SC 2.5.8 24px. A walking user is the
    // worst case all three are averaged over, so the largest wins.
    expect(MIN_TOUCH).toBeGreaterThanOrEqual(48);
    expect(PRIMARY_ACTION_HEIGHT).toBeGreaterThan(MIN_TOUCH);
  });
});
