
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import type { VenueGeometry } from '@crowdflow/contracts/wire';
import { radius } from '../theme';

const TRACK = '#5A626B';
const EDGE = '#A8B0B7';
const GATE = '#0E1213';
const PAD = 6;

export function MapView({ geometry }: { geometry: VenueGeometry }) {
  const frame = useMemo(() => frameOf(geometry), [geometry]);
  if (!frame) return null;

  const { minX, minY, maxX, maxY } = frame.bounds;
  const width = 320;
  const height = Math.max(120, Math.round(width * ((maxY - minY) / (maxX - minX || 1))));

  const toX = (x: number) => PAD + ((x - minX) / (maxX - minX || 1)) * (width - PAD * 2);
  const toY = (y: number) => height - PAD - ((y - minY) / (maxY - minY || 1)) * (height - PAD * 2);

  const trackPoints = (geometry.track ?? [])
    .map((point) => `${toX(point.x)},${toY(point.y)}`)
    .join(' ');

  const zones = geometry.pack.zones ?? {};
  const edges = geometry.pack.edges ?? {};
  const gates = Object.values(zones).filter((zone) => zone.kind === 'gate');

  return (
    <View
      style={{
        width: '100%',
        aspectRatio: width / height,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: '#F1F4F4',
      }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        {Object.values(edges).map((edge) => {
          const a = zones[edge.source];
          const b = zones[edge.destination];
          if (!a || !b) return null;
          return (
            <Line
              key={edge.id}
              x1={toX(a.position.x)}
              y1={toY(a.position.y)}
              x2={toX(b.position.x)}
              y2={toY(b.position.y)}
              stroke={EDGE}
              strokeWidth={0.8}
              strokeOpacity={0.6}
            />
          );
        })}

        {geometry.track && geometry.track.length > 1 ? (
          <Polyline points={trackPoints} fill="none" stroke={TRACK} strokeWidth={2.5} />
        ) : null}

        {gates.map((zone) => (
          <Circle
            key={zone.id}
            cx={toX(zone.position.x)}
            cy={toY(zone.position.y)}
            r={3}
            fill={GATE}
          />
        ))}
      </Svg>
    </View>
  );
}

function frameOf(geometry: VenueGeometry) {
  const zones = geometry.pack.zones ?? {};
  const points: Array<{ x: number; y: number }> = [
    ...Object.values(zones).map((zone) => zone.position),
    ...(geometry.track ?? []),
  ];
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { bounds: { minX, minY, maxX, maxY } };
}
