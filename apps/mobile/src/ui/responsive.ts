import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useWindowDimensions } from 'react-native';

import { BREAKPOINTS, space, spaceScaleFor, type, typeScaleFor, type TypeVariant } from '../theme';

export interface Metrics {
  width: number;
  height: number;
  landscape: boolean;
  tiny: boolean;
  compact: boolean;
  wide: boolean;
  gutter: number;
  maxContentWidth: number;
  typeScale: number;
  spaceScale: number;
}

export function useMetrics(): Metrics {
  const { width, height } = useWindowDimensions();
  return useMemo(() => {
    const landscape = width > height;
    const tiny = width < BREAKPOINTS.tiny;
    const compact = width < BREAKPOINTS.small;
    const wide = width >= BREAKPOINTS.wide;
    const spaceScale = spaceScaleFor(width);
    return {
      width,
      height,
      landscape,
      tiny,
      compact,
      wide,
      gutter: Math.round(space.lg * spaceScale),
      maxContentWidth: wide ? 560 : width,
      typeScale: typeScaleFor(width),
      spaceScale,
    };
  }, [width, height]);
}

export function useStep(): (value: number) => number {
  const { spaceScale } = useMetrics();
  return useMemo(() => (value: number) => Math.round(value * spaceScale), [spaceScale]);
}

export interface ResolvedType {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  letterSpacing: number;
  maxFontSizeMultiplier: number;
}

export function useTypeStyle(variant: TypeVariant): ResolvedType {
  const { typeScale } = useMetrics();
  return useMemo(() => {
    const spec = type[variant];
    return {
      fontSize: Math.round(spec.size * typeScale),
      lineHeight: Math.round(spec.lineHeight * typeScale),
      fontFamily: spec.family,
      letterSpacing: spec.letterSpacing,
      maxFontSizeMultiplier: spec.maxScale,
    };
  }, [variant, typeScale]);
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
