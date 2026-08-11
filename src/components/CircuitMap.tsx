import { useMemo } from "react";
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
  compact = false,
}: Props) {
  const pathLine = (ids: string[]) =>
    ids
      .map((id, i) => {
        const n = NODE_MAP[id];
        if (!n) return "";
        return `${i === 0 ? "M" : "L"} ${n.x} ${n.y}`;
      })
      .join(" ");

  const heat = useMemo(
    () =>
      ZONES.map((z) => {
        const d = density(state, z.id);
        return { z, d, r: 26 + Math.min(1.3, d) * 52 };
      }),
    [state],
  );

  return (
    <div className="panel relative overflow-hidden">
      <svg viewBox="0 0 1000 640" className={compact ? "w-full" : "w-full"} role="img" aria-label="Live circuit crowd map">
        <defs>
          <radialGradient id="heatGrad">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="70%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--color-grid)" strokeWidth="0.6" />
          </pattern>
        </defs>

        <rect width="1000" height="640" fill="url(#mapGrid)" opacity="0.5" />

        {/* Terrain / infield */}
        <path d={TRACK_PATH} fill="var(--color-terrain)" opacity="0.55" />
        <path d={TRACK_PATH} fill="none" stroke="var(--color-track)" strokeWidth="26" strokeLinejoin="round" />
        <path d={TRACK_PATH} fill="none" stroke="var(--color-border)" strokeWidth="1.5" strokeDasharray="8 10" />
        <path d={PIT_LANE_PATH} fill="var(--color-surface-2)" stroke="var(--color-border)" />
        <text x="576" y="318" textAnchor="middle" className="fill-muted-foreground" fontSize="11" fontFamily="var(--font-mono)">
          PIT LANE
        </text>

        {/* Heat blobs */}
        {heat.map(({ z, d, r }) => (
          <circle
            key={`heat-${z.id}`}
            cx={z.x}
            cy={z.y}
            r={r}
            fill="url(#heatGrad)"
            style={{ color: SEV_COLOR[severityOf(d)] }}
          />
        ))}

        {/* Walkways */}
        {EDGES.map((e) => {
          const a = NODE_MAP[e.a]!;
          const b = NODE_MAP[e.b]!;
          const key = edgeKey(e.a, e.b);
          const closed = params.closedEdges.includes(key);
          const ratio = (state.flows[key] ?? 0) / e.throughput;
          const sev = severityOf(ratio);
          return (
            <g key={key}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={closed ? "var(--color-muted-foreground)" : showFlows ? SEV_COLOR[sev] : "var(--color-border)"}
                strokeOpacity={closed ? 0.5 : sev === "ok" ? 0.35 : 0.9}
                strokeWidth={closed ? 1.5 : 1.5 + Math.min(1.2, ratio) * 4}
                strokeDasharray={closed ? "4 5" : undefined}
                strokeLinecap="round"
              />
            </g>
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
            <g key={f.id} onClick={() => onSelect?.(f.id)} className="cursor-pointer">
              <circle
                cx={f.x}
                cy={f.y}
                r="7"
                fill="var(--color-surface-2)"
                stroke={SEV_COLOR[severityOf(density(state, f.id))]}
                strokeWidth="2"
              />
            </g>
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
                r={active ? 15 : 12}
                fill={SEV_COLOR[sev]}
                fillOpacity="0.9"
                stroke={active ? "var(--color-foreground)" : "var(--color-background)"}
                strokeWidth="2"
              />
              <text
                x={z.x}
                y={z.y - 20}
                textAnchor="middle"
                fontSize="12"
                fontFamily="var(--font-display)"
                fill="var(--color-foreground)"
              >
                {z.name}
              </text>
              <text
                x={z.x}
                y={z.y + 28}
                textAnchor="middle"
                fontSize="11"
                fontFamily="var(--font-mono)"
                fill="var(--color-muted-foreground)"
              >
                {Math.round((state.occupancy[z.id] ?? 0) / 100) / 10}k · {Math.round(d * 100)}%
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3">
        {(["ok", "watch", "warning", "critical"] as const).map((s) => (
          <span key={s} className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV_COLOR[s] }} />
            {s}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          Line thickness = pedestrian flow · circle = zone occupancy
        </span>
      </div>
    </div>
  );
}
