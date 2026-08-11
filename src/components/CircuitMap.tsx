import { useState } from "react";
import {
  EDGES,
  FACILITIES,
  GATES,
  NODE_MAP,
  PIT_LANE_PATH,
  TRACK_PATH,
  ZONES,
} from "@/lib/venue";
import { density, edgeKey, severityOf, type SimParams, type SimState } from "@/lib/sim";
import { HeatLayer } from "./HeatLayer";
import { HEAT_BANDS, type HeatField } from "@/lib/heat";

const SEV_COLOR: Record<string, string> = {
  ok: "var(--color-ok)",
  watch: "var(--color-watch)",
  warning: "var(--color-warning)",
  critical: "var(--color-critical)",
};

interface Props {
  state: SimState;
  params: SimParams;
  selected?: string | null;
  onSelect?: (id: string) => void;
  highlightPath?: string[];
  comparePath?: string[];
  showFacilities?: boolean;
  showFlows?: boolean;
  compact?: boolean;
}

export function CircuitMap({
  state,
  params,
  selected,
  onSelect,
  highlightPath = [],
  comparePath = [],
  showFacilities = true,
  showFlows = true,
}: Props) {
  const [field, setField] = useState<HeatField | null>(null);

  const pathLine = (ids: string[]) =>
    ids
      .map((id, i) => {
        const n = NODE_MAP[id];
        if (!n) return "";
        return `${i === 0 ? "M" : "L"} ${n.x} ${n.y}`;
      })
      .join(" ");

  return (
    <div className="panel relative overflow-hidden">
      <div className="relative">
        {/* Base terrain */}
        <svg
          viewBox="0 0 1000 640"
          className="absolute inset-0 h-full w-full"
          aria-hidden
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--color-grid)" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="1000" height="640" fill="url(#mapGrid)" opacity="0.5" />
          <path d={TRACK_PATH} fill="var(--color-terrain)" opacity="0.55" />
          <path d={TRACK_PATH} fill="none" stroke="var(--color-track)" strokeWidth="26" strokeLinejoin="round" />
          <path d={TRACK_PATH} fill="none" stroke="var(--color-border)" strokeWidth="1.5" strokeDasharray="8 10" />
          <path d={PIT_LANE_PATH} fill="var(--color-surface-2)" stroke="var(--color-border)" />
        </svg>

        {/* Crowd-density heat map, computed from live head counts */}
        <HeatLayer
          state={state}
          onField={setField}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-95"
        />

        {/* Network + labels */}
        <svg
          viewBox="0 0 1000 640"
          className="relative block w-full"
          role="img"
          aria-label="Live circuit crowd heat map"
        >
          <text x="576" y="318" textAnchor="middle" className="fill-muted-foreground" fontSize="11" fontFamily="var(--font-mono)">
            PIT LANE
          </text>

          {/* Walkways */}
          {EDGES.map((e) => {
            const a = NODE_MAP[e.a]!;
            const b = NODE_MAP[e.b]!;
            const key = edgeKey(e.a, e.b);
            const closed = params.closedEdges.includes(key);
            const ratio = (state.flows[key] ?? 0) / e.throughput;
            const sev = severityOf(ratio);
            return (
              <line
                key={key}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={closed ? "var(--color-muted-foreground)" : showFlows ? SEV_COLOR[sev] : "var(--color-border)"}
                strokeOpacity={closed ? 0.5 : sev === "ok" ? 0.28 : 0.75}
                strokeWidth={closed ? 1.5 : 1.5 + Math.min(1.2, ratio) * 4}
                strokeDasharray={closed ? "4 5" : undefined}
                strokeLinecap="round"
              />
            );
          })}

          {/* Suggested route overlays */}
          {comparePath.length > 1 && (
            <path d={pathLine(comparePath)} fill="none" stroke="var(--color-muted-foreground)" strokeWidth="4" strokeDasharray="10 8" strokeLinecap="round" opacity="0.8" />
          )}
          {highlightPath.length > 1 && (
            <path d={pathLine(highlightPath)} fill="none" stroke="var(--color-accent)" strokeWidth="5" strokeLinecap="round" />
          )}

          {/* Gates */}
          {GATES.map((g) => {
            const q = state.queues[g.id] ?? 0;
            const wait = q / ((g.capacity / 35) * params.staffing * params.flowRate);
            const sev = wait > 20 ? "critical" : wait > 12 ? "warning" : wait > 6 ? "watch" : "ok";
            const active = selected === g.id;
            return (
              <g key={g.id} onClick={() => onSelect?.(g.id)} className="cursor-pointer">
                {sev !== "ok" && (
                  <circle cx={g.x} cy={g.y} r="16" fill={SEV_COLOR[sev]} className="pulse-ring" />
                )}
                <rect
                  x={g.x - 11}
                  y={g.y - 11}
                  width="22"
                  height="22"
                  rx="4"
                  fill={SEV_COLOR[sev]}
                  stroke={active ? "var(--color-foreground)" : "var(--color-background)"}
                  strokeWidth="2"
                />
                <text x={g.x} y={g.y + 4} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--color-background)">
                  {g.id.slice(1)}
                </text>
                <text x={g.x} y={g.y + 30} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--color-muted-foreground)">
                  {Math.round(q).toLocaleString()} waiting
                </text>
              </g>
            );
          })}

          {/* Facilities */}
          {showFacilities &&
            FACILITIES.map((f) => (
              <circle
                key={f.id}
                cx={f.x}
                cy={f.y}
                r="7"
                fill="var(--color-surface-2)"
                fillOpacity="0.7"
                stroke={SEV_COLOR[severityOf(density(state, f.id))]}
                strokeWidth="2"
                className="cursor-pointer"
                onClick={() => onSelect?.(f.id)}
              />
            ))}

          {/* Zones */}
          {ZONES.map((z) => {
            const d = density(state, z.id);
            const sev = severityOf(d);
            const active = selected === z.id;
            return (
              <g key={z.id} onClick={() => onSelect?.(z.id)} className="cursor-pointer">
                {sev === "critical" && (
                  <circle cx={z.x} cy={z.y} r="22" fill={SEV_COLOR["critical"]} className="pulse-ring" />
                )}
                <circle
                  cx={z.x}
                  cy={z.y}
                  r={active ? 13 : 9}
                  fill="var(--color-background)"
                  fillOpacity="0.75"
                  stroke={SEV_COLOR[sev]}
                  strokeWidth="3"
                />
                <text
                  x={z.x}
                  y={z.y - 18}
                  textAnchor="middle"
                  fontSize="12"
                  fontFamily="var(--font-display)"
                  fill="var(--color-foreground)"
                  style={{ paintOrder: "stroke", stroke: "var(--color-background)", strokeWidth: 3 }}
                >
                  {z.name}
                </text>
                <text
                  x={z.x}
                  y={z.y + 26}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fill="var(--color-foreground)"
                  style={{ paintOrder: "stroke", stroke: "var(--color-background)", strokeWidth: 3 }}
                >
                  {Math.round((state.occupancy[z.id] ?? 0) / 100) / 10}k · {Math.round(d * 100)}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Crowd density
        </span>
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-40 rounded-full"
            style={{
              background: `linear-gradient(90deg, #0c2060, ${HEAT_BANDS.map((b) => b.color).join(", ")}, #ffebeb)`,
            }}
          />
          <span className="font-mono text-[11px] text-muted-foreground">0 → 2.5 people/m²</span>
        </div>
        {HEAT_BANDS.slice(1).map((b) => (
          <span key={b.label} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          Peak {field ? field.peak.toFixed(1) : "—"} p/m² · {field ? Math.round(field.people).toLocaleString() : "—"} people mapped
        </span>
      </div>
    </div>
  );
}
