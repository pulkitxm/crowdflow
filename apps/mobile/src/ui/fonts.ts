import {
  BarlowSemiCondensed_600SemiBold,
  BarlowSemiCondensed_700Bold,
} from '@expo-google-fonts/barlow-semi-condensed';
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans';
import { useFonts } from 'expo-font';

export const FONT_ASSETS = {
  BarlowSemiCondensed_600SemiBold,
  BarlowSemiCondensed_700Bold,
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
};

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_ASSETS);
  return loaded || error != null;
}
