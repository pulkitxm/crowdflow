import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { CircuitMap } from "@/components/CircuitMap";
import { SimControls } from "@/components/SimControls";
import { useSim } from "@/lib/sim-store";
import { routeBetween } from "@/lib/sim";
import { GATES, NODE_MAP, ZONES } from "@/lib/venue";

export const Route = createFileRoute("/routing")({
  head: () => ({
    meta: [
      { title: "Real-time Rerouting — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Compare the shortest walking route with the congestion-aware route the optimiser recommends to spectators.",
      },
      { property: "og:title", content: "Real-time Rerouting — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "Congestion-aware pathfinding that guides people away from crowded areas.",
      },
    ],
  }),
  component: RoutingPage,
});

function RoutingPage() {
  const { state, params } = useSim();
  const [from, setFrom] = useState("g1");
  const [to, setTo] = useState("stowe");
  const { direct, optimised } = routeBetween(state, params, from, to);
  const saved = direct.minutes - optimised.minutes;

  const gateAdvice = GATES.map((g) => {
    const r = routeBetween(state, params, g.id, to);
    return { gate: g, ...r };
  }).sort((a, b) => a.optimised.minutes - b.optimised.minutes);

  const options = [...GATES, ...ZONES];

  return (
    <AppShell>
      <PageTitle
        title="Real-time rerouting"
        subtitle="The optimiser weights every walkway by live congestion, so the recommended path is not always the shortest one."
      />

      <div className="mb-4">
        <SimControls />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <CircuitMap
          state={state}
          params={params}
          highlightPath={optimised.path}
          comparePath={direct.path}
          selected={to}
          onSelect={setTo}
        />

        <div className="space-y-4">
          <div className="panel space-y-3 p-4">
            <div className="label-xs">Plan a route</div>
            <Select label="From" value={from} onChange={setFrom} options={options} />
            <Select label="To" value={to} onChange={setTo} options={options} />
            <p className="font-mono text-[11px] text-muted-foreground">
              Tip: click any zone on the map to set the destination.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <Stat label="Shortest route" value={`${direct.minutes.toFixed(1)} min`} hint={`peak congestion ${Math.round(direct.congestion * 100)}%`} />
            <Stat
              label="Optimiser route"
              value={`${optimised.minutes.toFixed(1)} min`}
              hint={`peak congestion ${Math.round(optimised.congestion * 100)}%`}
              tone="ok"
            />
            <Stat
              label="Time saved"
              value={`${saved > 0 ? "−" : "+"}${Math.abs(saved).toFixed(1)} min`}
              hint={saved > 0 ? "by avoiding crowded walkways" : "routes currently identical"}
              tone={saved > 0 ? "ok" : "default"}
            />
          </div>

          <div className="panel p-3 sm:p-4">
            <div className="label-xs mb-2">Recommended path</div>
            <ol className="space-y-1 font-mono text-xs">
              {optimised.path.map((id, i) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <span>{NODE_MAP[id]?.name ?? id}</span>
                </li>
              ))}
            </ol>
            <div className="label-xs mt-4 mb-2">Shortest path (for comparison)</div>
            <p className="font-mono text-xs text-muted-foreground">
              {direct.path.map((id) => NODE_MAP[id]?.name ?? id).join(" → ")}
            </p>
          </div>

          <div className="panel p-3 sm:p-4">
            <div className="label-xs mb-3">Best gate for this destination</div>
            <ul className="space-y-2">
              {gateAdvice.slice(0, 5).map(({ gate, optimised: o }) => (
                <li key={gate.id} className="flex items-center gap-3 rounded-md bg-surface-2/50 px-3 py-2 font-mono text-xs">
                  <span>{gate.name}</span>
                  <span className="ml-auto text-muted-foreground">{o.minutes.toFixed(1)} min walk</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <label className="block">
      <span className="label-xs">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
