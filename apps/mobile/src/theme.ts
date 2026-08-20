/**
 * Design tokens.
 *
 * This screen is read outdoors, in direct sun, one-handed, by someone walking in
 * a crowd who is also carrying a coat and a programme. That is a harder viewing
 * condition than any office product designs for, and it drives every value here:
 * near-black on near-white, type a size larger than feels necessary indoors,
 * colour that never carries meaning on its own, and targets big enough to hit
 * without looking.
 *
 * Every number is named, and the ones that come from a published accessibility
 * standard cite it. Sizes with no external source are marked ASSUMED with the
 * reasoning, per invariant 1: taste is allowed, but it has to say it is taste.
 */

/**
 * Minimum touch target, in density-independent pixels.
 *
 * Source: Apple Human Interface Guidelines give 44pt; Material Design 3 gives
 * 48dp; WCAG 2.2 SC 2.5.8 (Target Size, Minimum) gives 24 CSS px as the floor.
 * The largest of the three is taken, because a walking user is the worst case
 * these guidelines are averaged over.
 */
export const MIN_TOUCH = 48;

/**
 * Primary action height. ASSUMED: above the 48dp minimum because the primary
 * action here is pressed while walking, sometimes with gloves, and a miss costs
 * a stop in a moving crowd. Rounded to the type scale rather than tuned.
 */
export const PRIMARY_ACTION_HEIGHT = 64;

/**
 * Text contrast floors, used by the palette test.
 *
 * Source: WCAG 2.2 SC 1.4.3 requires 4.5:1 for body text and 3:1 for large text
 * (>= 18.66px bold or 24px regular); SC 1.4.11 requires 3:1 for the boundary of
 * a UI component. Sunlight legibility is not something WCAG covers, so the
 * palette aims well above these floors rather than at them.
 */
export const CONTRAST_BODY = 4.5;
export const CONTRAST_LARGE = 3.0;

/**
 * Spacing scale, in dp. ASSUMED: a 4dp grid, the common denominator of both
 * platform grids, so that nothing lands on a half pixel.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

/**
 * Type scale, in dp.
 *
 * ASSUMED, from the reading distance rather than from a standard: a phone held
 * at arm's length while walking is roughly 45cm away instead of the 35cm of
 * seated reading, so the body size is set a step above a typical mobile 16.
 * `display` is the minutes figure — the one number the user came for.
 */
export const type = {
  display: { size: 60, lineHeight: 64, weight: '700' as const, letterSpacing: -1.5 },
  title: { size: 30, lineHeight: 36, weight: '700' as const, letterSpacing: -0.4 },
  headline: { size: 22, lineHeight: 30, weight: '600' as const, letterSpacing: -0.2 },
  body: { size: 18, lineHeight: 26, weight: '400' as const, letterSpacing: 0 },
  label: { size: 15, lineHeight: 20, weight: '600' as const, letterSpacing: 0.3 },
  micro: { size: 13, lineHeight: 18, weight: '600' as const, letterSpacing: 0.6 },
} as const;

interface StatusColors {
  fill: string;
  text: string;
  edge: string;
}

export interface Palette {
  paper: string;
  surface: string;
  ink: string;
  inkSoft: string;
  line: string;
  /** Inverted pair, for the single primary action on a screen. */
  actionFill: string;
  actionText: string;
  clear: StatusColors;
  slowing: StatusColors;
  backingUp: StatusColors;
  unknown: StatusColors;
}

/**
 * Light is the working theme: this app is used in daylight, and a dark screen in
 * sun is unreadable however elegant it looks indoors. Dark exists for the walk
 * back to the car park, not as the default.
 *
 * The status colours are deliberately quiet — a desaturated fill with strongly
 * contrasting text, rather than the saturated red/amber/green of a control room.
 * Colour is never the only carrier: every status renders its word beside it, for
 * colour-blind users and for anyone glancing at a screen washed out by the sun.
 */
const light: Palette = {
  paper: '#FFFFFF',
  surface: '#F1F4F4',
  ink: '#0E1213',
  inkSoft: '#4C5658',
  line: '#D6DCDD',
  actionFill: '#0E1213',
  actionText: '#FFFFFF',
  clear: { fill: '#E2F2E8', text: '#0A5733', edge: '#4B8769' },
  slowing: { fill: '#FBEED5', text: '#6E4300', edge: '#8B641A' },
  backingUp: { fill: '#FBE4E1', text: '#9A150D', edge: '#A64439' },
  unknown: { fill: '#EAEDEE', text: '#3E484A', edge: '#687477' },
};

const dark: Palette = {
  paper: '#0B0E0F',
  surface: '#171C1D',
  ink: '#F3F6F6',
  inkSoft: '#A9B3B5',
  line: '#2B3234',
  actionFill: '#F3F6F6',
  actionText: '#0B0E0F',
  clear: { fill: '#0F2A1D', text: '#7FDCA9', edge: '#62B88B' },
  slowing: { fill: '#2E2309', text: '#F2C77A', edge: '#C79B4E' },
  backingUp: { fill: '#33140F', text: '#F5A096', edge: '#D7776D' },
  unknown: { fill: '#1E2426', text: '#B4BEC0', edge: '#8E9A9D' },
};

export type ThemeName = 'light' | 'dark';

export const palettes: Record<ThemeName, Palette> = { light, dark };
