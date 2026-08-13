/**
 * Theme plumbing. Light by default because this is a daylight product; the
 * device's own setting wins, and the demo shell can force either one so a
 * reviewer can check both without changing their OS.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { palettes, type Palette, type ThemeName } from '../theme';

const ThemeContext = createContext<Palette>(palettes.light);

export function ThemeProvider({
  override,
  children,
}: {
  override?: ThemeName;
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  const name: ThemeName = override ?? (system === 'dark' ? 'dark' : 'light');
  const palette = useMemo(() => palettes[name], [name]);
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}

export function usePalette(): Palette {
  return useContext(ThemeContext);
}
