import { createFileRoute } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useSim } from "@/lib/sim-store";
import { density, detectBottlenecks, forecast, inside, queued } from "@/lib/sim";
import { CIRCUIT_SPECS, clockLabel, ZONES } from "@/lib/venue";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Event Report — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Post-event debrief: peak occupancy, gate throughput, time spent in risky density and exportable data.",
      },
      { property: "og:title", content: "Event Report — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "KPIs and exportable crowd data for the safety debrief after the event.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { state, params, history, circuitId } = useSim();
  const circuit = CIRCUIT_SPECS.find((c) => c.id === circuitId) ?? CIRCUIT_SPECS[0]!;
  const bns = detectBottlenecks(state, params);

  const series = history.map((h) => ({
    label: clockLabel(h.t),
    inside: Math.round(h.inside),
    queued: Math.round(h.queued),
  }));
  const peakInside = history.reduce((m, h) => Math.max(m, h.inside), inside(state));
  const peakQueue = history.reduce((m, h) => Math.max(m, h.queued), queued(state));
  const riskyMinutes = history.filter((h) => h.queued > params.crowdSize * 0.03).length;

  const zoneRows = ZONES.map((z) => {
    const d = density(state, z.id);
    const future = forecast(state, params, 30);
    const peak = future.reduce((m, f) => Math.max(m, density(f, z.id)), d);
    return { z, d, peak };
  }).sort((a, b) => b.peak - a.peak);

  const exportCsv = () => {
    const rows = [
      ["zone", "capacity", "occupancy_now", "density_now", "forecast_peak_30min"],
      ...zoneRows.map((r) => [
        r.z.name,
        String(r.z.capacity),
        String(Math.round(state.occupancy[r.z.id] ?? 0)),
        r.d.toFixed(3),
        r.peak.toFixed(3),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${circuit.id}-crowd-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <PageTitle
        title="Event report"
        subtitle="What the day looked like so far, and the numbers a safety officer needs for the debrief."
        right={<Button onClick={exportCsv}>Export CSV</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Peak inside" value={Math.round(peakInside).toLocaleString()} hint={circuit.name} />
        <Stat label="Peak gate queue" value={Math.round(peakQueue).toLocaleString()} tone="warning" />
        <Stat label="Minutes in stress" value={String(riskyMinutes)} hint="queues above 3% of crowd" />
        <Stat
          label="Open issues"
          value={String(bns.length)}
          tone={bns.some((b) => b.severity === "critical") ? "critical" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="label-xs mb-3">Occupancy timeline</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" minTickGap={30} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" width={50} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="inside" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.25} />
                <Area type="monotone" dataKey="queued" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {!series.length && (
            <p className="font-mono text-xs text-muted-foreground">
              Let the simulation run for a minute to build history.
            </p>
          )}
        </div>

        <div className="panel p-4">
          <div className="label-xs mb-3">Forecast peak density by zone (next 30 min)</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={zoneRows.map((r) => ({ name: r.z.name, peak: Math.round(r.peak * 100) }))}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="var(--color-muted-foreground)" interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" width={40} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="peak" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel mt-4 p-4">
        <div className="label-xs mb-3">Zone summary</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2">Zone</th>
                <th>Capacity</th>
                <th>Now</th>
                <th>Density</th>
                <th>Forecast peak</th>
              </tr>
            </thead>
            <tbody>
              {zoneRows.map((r) => (
                <tr key={r.z.id} className="border-t border-border/60">
                  <td className="py-2 font-display text-sm">{r.z.name}</td>
                  <td>{r.z.capacity.toLocaleString()}</td>
                  <td>{Math.round(state.occupancy[r.z.id] ?? 0).toLocaleString()}</td>
                  <td>{Math.round(r.d * 100)}%</td>
                  <td
                    style={{
                      color:
                        r.peak > 0.95
                          ? "var(--color-critical)"
                          : r.peak > 0.78
                            ? "var(--color-warning)"
                            : "var(--color-ok)",
                    }}
                  >
                    {Math.round(r.peak * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
