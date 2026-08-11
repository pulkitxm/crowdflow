import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { SimControls } from "@/components/SimControls";
import { Button } from "@/components/ui/button";
import { useSim } from "@/lib/sim-store";
import { buildEvacPlan, SCENARIOS, nodeName, type EvacScenario } from "@/lib/evacuation";
import { ZONES } from "@/lib/venue";

export const Route = createFileRoute("/evacuation")({
  head: () => ({
    meta: [
      { title: "Evacuation Planner — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Assign every zone to the fastest safe emergency exit and see how long a full venue clearance takes.",
      },
      { property: "og:title", content: "Evacuation Planner — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "Emergency exit assignment, exit loading and clearance time for any incident scenario.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EvacuationPage,
});

function EvacuationPage() {
  const { state, params } = useSim();
  const [scenario, setScenario] = useState<EvacScenario>("none");
  const [incidentZone, setIncidentZone] = useState(ZONES[0]?.id ?? "");
  const plan = buildEvacPlan(state, params, scenario, incidentZone);
  const active = SCENARIOS.find((s) => s.id === scenario)!;

  return (
    <AppShell>
      <PageTitle
        title="Evacuation planner"
        subtitle="Every occupied zone is assigned to the fastest exit that is still safe, balancing walking time against how loaded each gate already is."
        right={
          <Button
            onClick={() =>
              toast.success("Evacuation plan broadcast", {
                description: "Mock: signage, steward radios and the spectator app now show these exits.",
              })
            }
          >
            Broadcast plan
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People to move" value={Math.round(plan.totalPeople).toLocaleString()} />
        <Stat
          label="Full clearance"
          value={`${Math.round(plan.clearanceMinutes)} min`}
          tone={plan.clearanceMinutes > 25 ? "critical" : plan.clearanceMinutes > 15 ? "warning" : "ok"}
          hint="last person out"
        />
        <Stat label="Exits in use" value={String(plan.gateLoads.length)} />
        <Stat
          label="Busiest exit"
          value={plan.gateLoads[0]?.name ?? "—"}
          hint={plan.gateLoads[0] ? `${Math.round(plan.gateLoads[0].clearMinutes)} min to clear` : ""}
        />
      </div>

      <div className="mb-4">
        <SimControls />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <div className="panel p-3 sm:p-4">
            <div className="label-xs mb-3">Incident scenario</div>
            <div className="grid gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScenario(s.id)}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    scenario === s.id
                      ? "border-accent bg-accent/10"
                      : "border-border hover:bg-secondary"
                  }`}
                >
                  <div className="font-display text-sm">{s.label}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.blurb}</p>
                </button>
              ))}
            </div>
            {(scenario === "fire" || scenario === "medical") && (
              <div className="mt-3">
                <div className="label-xs mb-1">Incident location</div>
                <select
                  value={incidentZone}
                  onChange={(e) => setIncidentZone(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs"
                >
                  {ZONES.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">
              {plan.blockedZone && `${nodeName(plan.blockedZone)} treated as unusable. `}
              {plan.blockedGate && `${nodeName(plan.blockedGate)} locked down. `}
              {active.blurb}
            </p>
          </div>

          <div className="panel p-3 sm:p-4">
            <div className="label-xs mb-3">Exit loading</div>
            <ul className="space-y-3">
              {plan.gateLoads.map((g) => (
                <li key={g.gateId}>
                  <div className="flex items-baseline justify-between font-mono text-xs">
                    <span className="font-display text-sm">{g.name}</span>
                    <span className="text-muted-foreground">
                      {Math.round(g.people).toLocaleString()} · {Math.round(g.ratePerMin)}/min ·{" "}
                      {Math.round(g.clearMinutes)} min
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, g.utilisation * 100)}%`,
                        background:
                          g.utilisation > 0.95
                            ? "var(--color-critical)"
                            : g.utilisation > 0.7
                              ? "var(--color-warning)"
                              : "var(--color-ok)",
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="panel p-3 sm:p-4">
          <div className="label-xs mb-3">Zone → exit assignments</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left font-mono text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2">Zone</th>
                  <th>People</th>
                  <th>Exit</th>
                  <th>Walk</th>
                  <th className="hidden lg:table-cell">Route</th>
                </tr>
              </thead>
              <tbody>
                {plan.assignments.map((a) => (
                  <tr key={a.zoneId} className="border-t border-border/60">
                    <td className="py-2">
                      <span className="font-display text-sm">{a.zoneName}</span>
                      {a.blocked && (
                        <span className="ml-2 rounded bg-critical px-1.5 text-[10px] text-background">
                          incident
                        </span>
                      )}
                    </td>
                    <td>{Math.round(a.people).toLocaleString()}</td>
                    <td className="text-accent">{a.gateName}</td>
                    <td>{a.walkMinutes.toFixed(1)} min</td>
                    <td className="hidden max-w-[22rem] truncate text-muted-foreground lg:table-cell">
                      {a.path.map(nodeName).join(" → ")}
                    </td>
                  </tr>
                ))}
                {!plan.assignments.length && (
                  <tr>
                    <td className="py-3 text-muted-foreground" colSpan={5}>
                      Venue is empty — nothing to evacuate.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
