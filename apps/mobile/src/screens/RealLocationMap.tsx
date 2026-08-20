/**
 * TEMPORARY — a real map, for checking that the location is actually right.
 * Deleted together with `LocationCheck.tsx`; nothing else imports it.
 *
 * Raster tiles from OpenStreetMap, positioned by hand. No `react-native-maps`,
 * no WebView, no API key, no new native module — which is the whole reason it
 * is built this way. A map library here would mean a native dependency added for
 * a screen that is going to be deleted, and it would not work in a browser,
 * which is the one place this can be tested with no build at all.
 *
 * The mechanism is the standard slippy-map projection: Web Mercator turns a
 * coordinate into a pixel position in a flat world image whose size is
 * 256 * 2^zoom, tiles are 256-pixel squares cut out of that image, and drawing a
 * map is working out which squares overlap the viewport and where each one lands.
 * It is about thirty lines and it is exact.
 *
 * Two honest notes:
 *
 * - The accuracy ring is drawn to scale, from metres per pixel at this latitude.
 *   It is the point of the screen, not decoration: a dot alone claims a precision
 *   no phone has, and the difference between a five-metre fix and a
 *   fifty-metre one is the difference between "this works" and "this does not".
 * - Tiles come from OpenStreetMap's public servers. Fine for a handful of
 *   requests while testing, not for anything shipped — their tile policy asks
 *   for a real User-Agent and rate limits, and a phone's `Image` loader sets
 *   neither. Another reason this screen is temporary.
 */

import React, { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { radius, space } from '../theme';
import { Body } from '../ui/atoms';
import { usePalette } from '../ui/theme';
import { MAX_ZOOM, TILE, metresPerPixel, tileUrl, tilesFor } from './mercator';

export function RealLocationMap({
  lat,
  lon,
  accuracyM,
  height = 280,
}: {
  lat: number;
  lon: number;
  accuracyM: number | null;
  height?: number;
}) {
  const palette = usePalette();
  const [zoom, setZoom] = useState(17);
  const [width, setWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const tiles = tilesFor(lat, lon, zoom, width, height);

  const ringPx = accuracyM == null ? 0 : (accuracyM / metresPerPixel(lat, zoom)) * 2;
  const scaleBarM = Math.round(metresPerPixel(lat, zoom) * 80);

  return (
    <View style={{ gap: space.sm }}>
      <View
        onLayout={onLayout}
        style={[styles.stage, { height, borderColor: palette.line, backgroundColor: palette.surface }]}
      >
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tileUrl(tile) }}
            style={{ position: 'absolute', left: tile.left, top: tile.top, width: TILE, height: TILE }}
          />
        ))}

        {/* The accuracy ring, to scale. Drawn under the dot so the dot stays
            legible when the ring is small. Hidden when it would be smaller than
            the dot itself, because a ring inside the marker says nothing. */}
        {ringPx > 18 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: width / 2 - ringPx / 2,
              top: height / 2 - ringPx / 2,
              width: ringPx,
              height: ringPx,
              borderRadius: ringPx / 2,
              borderWidth: 2,
              borderColor: 'rgba(30,110,230,0.9)',
              backgroundColor: 'rgba(30,110,230,0.18)',
            }}
          />
        ) : null}

        <View pointerEvents="none" style={[styles.dot, { left: width / 2 - 9, top: height / 2 - 9 }]} />

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

      {/* The independent check. If the pin here and the pin on osm.org land in
          the same place, the coordinate is right and nothing in this app is
          flattering itself. */}
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`)}
      >
        <Body color={palette.ink} style={{ textDecorationLine: 'underline' }}>
          Open this exact point on openstreetmap.org
        </Body>
      </Pressable>
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
