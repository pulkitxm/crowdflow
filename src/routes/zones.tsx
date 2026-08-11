import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SimControls } from "@/components/SimControls";
import { useSim } from "@/lib/sim-store";
import { density, predictRisks, severityOf } from "@/lib/sim";
import { FACILITIES, ZONES } from "@/lib/venue";

export const Route = createFileRoute("/zones")({
  head: () => ({
    meta: [
      { title: "Zone Occupancy — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Zone-by-zone occupancy, density and predicted peak load across every grandstand, concourse and concession area.",
      },
      { property: "og:title", content: "Zone Occupancy — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "Density, capacity headroom and 45-minute peak forecasts for every venue zone.",
      },
    ],
  }),
  component: ZonesPage,
});

const SECTORS = ["ALL", "NORTH", "EAST", "SOUTH", "WEST", "CENTRAL"] as const;

function ZonesPage() {
  const { state, params } = useSim();
  const [sector, setSector] = useState<(typeof SECTORS)[number]>("ALL");
  const risks = predictRisks(state, params);

  const rows = [...ZONES, ...FACILITIES]
    .filter((z) => sector === "ALL" || z.sector === sector)
    .map((z) => {
      const occ = state.occupancy[z.id] ?? 0;
      const d = density(state, z.id);
      const risk = risks.find((r) => r.id === z.id);
      return { z, occ, d, risk };
    })
    .sort((a, b) => b.d - a.d);

  const chartData = ZONES.map((z) => ({
    name: z.name,
    density: Math.round(density(state, z.id) * 100),
  })).sort((a, b) => b.density - a.density);

  return (
    <AppShell>
      <PageTitle
        title="Zone occupancy"
        subtitle="Zone-wise occupancy against comfortable capacity, with a 45-minute peak forecast produced by rolling the simulation forward."
      />

      <div className="mb-4">
        <SimControls />
      </div>

      <div className="mb-4 panel p-4">
        <div className="label-xs mb-3">Current density by zone (% of comfortable capacity)</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ bottom: 40 }}>
              <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} stroke="var(--color-muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} width={40} />
              <Tooltip
                cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="density" radius={[3, 3, 0, 0]}>
                {chartData.map((d) => (
                  <Cell key={d.name} fill={`var(--color-${severityOf(d.density / 100)})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {SECTORS.map((s) => (
          <button
            key={s}
            onClick={() => setSector(s)}
            className={`rounded px-3 py-1.5 font-mono text-xs uppercase tracking-widest ${
              sector === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {["Zone", "Sector", "Occupancy", "Capacity", "Density", "Predicted peak", "Status"].map((h) => (
                <th key={h} className="label-xs px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ z, occ, d, risk }) => {
              const sev = severityOf(d);
              return (
                <tr key={z.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3 font-display">{z.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{z.sector}</td>
                  <td className="px-4 py-3 font-mono text-xs">{Math.round(occ).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{z.capacity.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded bg-secondary">
                        <div
                          className="h-full rounded"
                          style={{ width: `${Math.min(100, d * 100)}%`, background: `var(--color-${sev})` }}
                        />
                      </div>
                      <span className="font-mono text-xs">{Math.round(d * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {risk ? `${Math.round(risk.peak * 100)}% in ${risk.atMinute} min` : "stable"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="rounded px-2 py-0.5 font-mono text-[10px] uppercase"
                      style={{ background: `var(--color-${sev})`, color: "var(--color-background)" }}
                    >
                      {sev}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
