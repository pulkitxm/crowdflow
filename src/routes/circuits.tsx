import { createFileRoute } from "@tanstack/react-router";
import { Check, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { simActions, useSim } from "@/lib/sim-store";
import { CIRCUIT_SPECS, getCircuit } from "@/lib/venue";

export const Route = createFileRoute("/circuits")({
  head: () => ({
    meta: [
      { title: "F1 Circuit Library · Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Switch the crowd simulation between Silverstone, Monza, Monaco, Spa, Interlagos and Marina Bay, each with its own zones, gates and walkway network.",
      },
      { property: "og:title", content: "F1 Circuit Library · Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "Load any of six famous Formula 1 venues into the live crowd flow simulation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CircuitsPage,
});

function CircuitsPage() {
  const { circuitId } = useSim();

  return (
    <AppShell>
      <div>
        <h1 className="font-display text-2xl tracking-wide">Circuit library</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Each venue is modelled with its own grandstand zones, entry gates, facilities and walkway
          graph. Load one to re-run the whole crowd simulation against it.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {CIRCUIT_SPECS.map((spec) => {
            const circuit = getCircuit(spec.id);
            const isActive = spec.id === circuitId;
            return (
              <button
                key={spec.id}
                type="button"
                onClick={() => simActions.setCircuit(spec.id)}
                className={`panel group text-left transition-colors ${
                  isActive ? "border-primary" : "hover:border-muted-foreground"
                }`}
              >
                <div className="relative">
                  <svg viewBox="0 0 1000 640" className="block w-full" aria-hidden>
                    <rect width="1000" height="640" fill="var(--color-surface-2)" />
                    <path d={circuit.trackPath} fill="var(--color-terrain)" opacity="0.5" />
                    <path
                      d={circuit.trackPath}
                      fill="none"
                      stroke={isActive ? "var(--color-primary)" : "var(--color-track)"}
                      strokeWidth="22"
                      strokeLinejoin="round"
                    />
                    {circuit.zones.map((z) => (
                      <circle key={z.id} cx={z.x} cy={z.y} r={7} fill="var(--color-watch)" opacity="0.8" />
                    ))}
                    {circuit.gates.map((g) => (
                      <rect
                        key={g.id}
                        x={g.x - 7}
                        y={g.y - 7}
                        width="14"
                        height="14"
                        fill="var(--color-ok)"
                        opacity="0.85"
                      />
                    ))}
                  </svg>
                  {isActive && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded bg-primary px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-primary-foreground">
                      <Check className="h-3 w-3" /> Loaded
                    </span>
                  )}
                </div>

                <div className="border-t border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-base tracking-wide">
                        {spec.flag} {spec.name}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {spec.location}, {spec.country}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{spec.blurb}</p>
                  <dl className="mt-3 grid grid-cols-4 gap-2 font-mono text-[11px] uppercase tracking-widest">
                    <Meta label="Length" value={`${spec.lengthKm} km`} />
                    <Meta label="Laps" value={String(spec.laps)} />
                    <Meta label="Crowd" value={`${Math.round(spec.attendance / 1000)}k`} />
                    <Meta label="Gates" value={String(circuit.gates.length)} />
                  </dl>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
