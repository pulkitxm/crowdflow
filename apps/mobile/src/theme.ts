
export const MIN_TOUCH = 48;

export const PRIMARY_ACTION_HEIGHT = 64;

export const CONTRAST_BODY = 4.5;
export const CONTRAST_LARGE = 3.0;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

export const fonts = {
  displaySemi: 'BarlowSemiCondensed_600SemiBold',
  displayBold: 'BarlowSemiCondensed_700Bold',
  bodyRegular: 'PublicSans_400Regular',
  bodyMedium: 'PublicSans_500Medium',
  bodySemi: 'PublicSans_600SemiBold',
  bodyBold: 'PublicSans_700Bold',
} as const;

export type FontName = (typeof fonts)[keyof typeof fonts];

export const type = {
  display: {
    size: 56,
    lineHeight: 58,
    weight: '700' as const,
    letterSpacing: -1.2,
    family: fonts.displayBold,
    maxScale: 1.25,
  },
  title: {
    size: 30,
    lineHeight: 34,
    weight: '700' as const,
    letterSpacing: -0.4,
    family: fonts.displayBold,
    maxScale: 1.3,
  },
  headline: {
    size: 23,
    lineHeight: 28,
    weight: '600' as const,
    letterSpacing: -0.1,
    family: fonts.displaySemi,
    maxScale: 1.4,
  },
  body: {
    size: 17,
    lineHeight: 25,
    weight: '400' as const,
    letterSpacing: 0,
    family: fonts.bodyRegular,
    maxScale: 1.7,
  },
  label: {
    size: 15,
    lineHeight: 20,
    weight: '600' as const,
    letterSpacing: 0.1,
    family: fonts.bodySemi,
    maxScale: 1.7,
  },
  micro: {
    size: 12,
    lineHeight: 16,
    weight: '700' as const,
    letterSpacing: 0.9,
    family: fonts.bodyBold,
    maxScale: 1.8,
  },
} as const;

export type TypeVariant = keyof typeof type;

export const BREAKPOINTS = { tiny: 340, small: 360, large: 414, wide: 600 } as const;

export function typeScaleFor(width: number): number {
  if (width < BREAKPOINTS.tiny) return 0.9;
  if (width < BREAKPOINTS.small) return 0.94;
  if (width < BREAKPOINTS.large) return 1;
  if (width < BREAKPOINTS.wide) return 1.05;
  return 1.1;
}

export function spaceScaleFor(width: number): number {
  if (width < BREAKPOINTS.tiny) return 0.85;
  if (width < BREAKPOINTS.small) return 0.92;
  if (width < BREAKPOINTS.wide) return 1;
  return 1.15;
}

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
  actionFill: string;
  actionText: string;
  clear: StatusColors;
  slowing: StatusColors;
  backingUp: StatusColors;
  unknown: StatusColors;
}

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
