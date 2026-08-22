
import React, { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { radius, space } from '../theme';
import { Body } from '../ui/atoms';
import { useMetrics } from '../ui/responsive';
import { usePalette } from '../ui/theme';
import { MAX_ZOOM, TILE, TILE_ATTRIBUTION, metresPerPixel, tileUrl, tilesFor } from './mercator';

export function RealLocationMap({
  lat,
  lon,
  accuracyM,
  height,
}: {
  lat: number;
  lon: number;
  accuracyM: number | null;
  height?: number;
}) {
  const palette = usePalette();
  const { height: screenHeight } = useMetrics();
  const [zoom, setZoom] = useState(17);
  const [width, setWidth] = useState(0);
  const stageHeight = height ?? Math.max(200, Math.min(320, Math.round(screenHeight * 0.32)));

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const tiles = tilesFor(lat, lon, zoom, width, stageHeight);

  const ringPx = accuracyM == null ? 0 : (accuracyM / metresPerPixel(lat, zoom)) * 2;
  const scaleBarM = Math.round(metresPerPixel(lat, zoom) * 80);

  return (
    <View style={{ gap: space.sm }}>
      <View
        onLayout={onLayout}
        style={[styles.stage, { height: stageHeight, borderColor: palette.line, backgroundColor: palette.surface }]}
      >
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tileUrl(tile) }}
            style={{ position: 'absolute', left: tile.left, top: tile.top, width: TILE, height: TILE }}
          />
        ))}

        {}
        {ringPx > 18 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: width / 2 - ringPx / 2,
              top: stageHeight / 2 - ringPx / 2,
              width: ringPx,
              height: ringPx,
              borderRadius: ringPx / 2,
              borderWidth: 2,
              borderColor: 'rgba(30,110,230,0.9)',
              backgroundColor: 'rgba(30,110,230,0.18)',
            }}
          />
        ) : null}

        <View pointerEvents="none" style={[styles.dot, { left: width / 2 - 9, top: stageHeight / 2 - 9 }]} />

        <View style={styles.scale} pointerEvents="none">
          <View style={styles.scaleBar} />
          <Body style={styles.scaleText}>{scaleBarM} m</Body>
        </View>
      </View>

      <View style={styles.controls}>
        <Zoom label="−" onPress={() => setZoom((z) => Math.max(3, z - 1))} />
        <Body tone="soft" style={{ flex: 1, textAlign: 'center' }}>zoom {zoom}</Body>
        <Zoom label="+" onPress={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))} />
      </View>

      {}
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`)}
      >
        <Body color={palette.ink} style={{ textDecorationLine: 'underline' }}>
          Open this exact point on openstreetmap.org
        </Body>
      </Pressable>

      <Body tone="soft" style={{ fontSize: 12, lineHeight: 16 }}>
        {TILE_ATTRIBUTION}
      </Body>
    </View>
  );
}

function Zoom({ label, onPress }: { label: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.zoom, { borderColor: palette.line, opacity: pressed ? 0.6 : 1 }]}
    >
      <Body color={palette.ink} style={{ fontWeight: '700', fontSize: 20, lineHeight: 24 }}>{label}</Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { overflow: 'hidden', borderRadius: radius.md, borderWidth: 1, position: 'relative' },
  dot: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1e6ee6',
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  scale: { position: 'absolute', left: 8, bottom: 8, gap: 2 },
  scaleBar: { width: 80, height: 3, backgroundColor: '#111', opacity: 0.75 },
  scaleText: { fontSize: 12, lineHeight: 14, color: '#111' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  zoom: {
    width: 48, height: 48, borderWidth: 1, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
});
