
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
