import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import type { VenuePoint } from '../core/contracts';
import type { VenueGraph } from '../venue/venueGraph';
import { colors } from './theme';

interface Props {
  graph: VenueGraph;
  position?: VenuePoint;
  route: string[];
  congestedZone?: string;
}

export function VenueMap({ graph, position, route, congestedZone }: Props) {
  const map = (point: VenuePoint): VenuePoint => ({ x: point.x, y: graph.bounds.yMax - point.y });
  return (
    <View style={{ height: 330, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.cream }}>
      <Svg width="100%" height="100%" viewBox={`-8 -8 ${graph.bounds.xMax + 16} ${graph.bounds.yMax + 16}`}>
        {graph.edges.map((edge) => {
          const from = map(graph.zone(edge.from).centroid); const to = map(graph.zone(edge.to).centroid);
          return <Line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={colors.ink} strokeOpacity={.16} strokeWidth={Math.max(3, edge.widthMetres)} strokeLinecap="round" />;
        })}
        {graph.zones.map((zone) => (
          <Polygon key={zone.id} points={zone.polygon.map(map).map((point) => `${point.x},${point.y}`).join(' ')}
            fill={zone.id === congestedZone ? colors.signal : colors.moss}
            fillOpacity={zone.id === congestedZone ? .50 : .10} stroke={colors.moss} strokeOpacity={.35} strokeWidth={1} />
        ))}
        {route.slice(0, -1).map((fromId, index) => {
          const from = map(graph.zone(fromId).centroid); const to = map(graph.zone(route[index + 1]).centroid);
          return <React.Fragment key={`${fromId}-${route[index + 1]}`}>
            <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={colors.lime} strokeWidth={8} strokeLinecap="round" />
            <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={colors.moss} strokeWidth={2} strokeLinecap="round" />
          </React.Fragment>;
        })}
        {position && <>
          <Circle cx={map(position).x} cy={map(position).y} r={11} fill={colors.white} />
          <Circle cx={map(position).x} cy={map(position).y} r={7} fill={colors.moss} />
          <Circle cx={map(position).x} cy={map(position).y} r={3} fill={colors.lime} />
        </>}
      </Svg>
    </View>
  );
}
