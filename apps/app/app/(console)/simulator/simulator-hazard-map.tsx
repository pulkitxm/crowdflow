import type { ScenarioSnapshot, VenueGeometry } from "@crowdflow/contracts/wire";

export function SimulatorHazardMap({ geometry, snapshot }: { geometry: VenueGeometry | null; snapshot: ScenarioSnapshot | null }) {
  if (!geometry) return <div className="empty">Venue geometry is loading</div>;
  const zones = geometry.pack.zones ?? {};
  const edges = geometry.pack.edges ?? {};
  const points = Object.values(zones).map((zone) => zone.position);
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = 80;
  return (
    <div className="hazard-map">
      <svg viewBox={`${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`} role="img" aria-label="Venue graph with active fires and blockages">
        <g className="hazard-map__graph">
          {Object.values(edges).map((edge) => {
            const source = zones[edge.source]?.position;
            const destination = zones[edge.destination]?.position;
            return source && destination ? <line key={edge.id} x1={source.x} y1={source.y} x2={destination.x} y2={destination.y} /> : null;
          })}
        </g>
        <g className="hazard-map__gates">
          {Object.values(zones).filter((zone) => zone.kind === "gate" || zone.kind === "exit").map((zone) => <circle key={zone.id} cx={zone.position.x} cy={zone.position.y} r="8"><title>{zone.name ?? zone.id}</title></circle>)}
        </g>
        <g className="hazard-map__hazards">
          {snapshot?.active_hazards.map((hazard) => {
            const target = hazard.location.position ?? zones[hazard.location.zone_id ?? hazard.location.gate_id ?? ""]?.position;
            const edge = edges[hazard.location.edge_id ?? ""];
            if (edge) {
              const source = zones[edge.source]?.position;
              const destination = zones[edge.destination]?.position;
              return source && destination ? <g key={hazard.id} className="hazard-mark hazard-mark--blockage"><line x1={source.x} y1={source.y} x2={destination.x} y2={destination.y} /><text x={(source.x + destination.x) / 2} y={(source.y + destination.y) / 2}>{hazard.id}</text></g> : null;
            }
            if (!target) return null;
            return <g key={hazard.id} className={`hazard-mark hazard-mark--${hazard.type}`}><circle cx={target.x} cy={target.y} r={hazard.type === "fire" ? Math.max(20, hazard.radius_m ?? 20) : 28} /><path d={`M ${target.x - 18} ${target.y - 18} L ${target.x + 18} ${target.y + 18} M ${target.x + 18} ${target.y - 18} L ${target.x - 18} ${target.y + 18}`} /><text x={target.x + 24} y={target.y - 24}>{hazard.id}: {hazard.type.replaceAll("_", " ")}</text></g>;
          })}
        </g>
      </svg>
      <div className="hazard-map__legend"><span><i className="legend-fire" />Fire radius and unsafe area</span><span><i className="legend-block" />Blocked or restricted connection</span><span><i className="legend-gate" />Gate or exit</span></div>
    </div>
  );
}
