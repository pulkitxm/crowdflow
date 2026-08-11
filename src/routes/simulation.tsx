import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { CircuitMap } from "@/components/CircuitMap";
import { SimControls } from "@/components/SimControls";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { simActions, useSim } from "@/lib/sim-store";
import {
  DEFAULT_PARAMS,
  createState,
  density,
  detectBottlenecks,
  forecast,
  queued,
  step,
  type SimParams,
} from "@/lib/sim";
import { EVENT_SCHEDULE, ZONES, clockLabel } from "@/lib/venue";

export const Route = createFileRoute("/simulation")({
  head: () => ({
    meta: [
      { title: "Crowd Simulation — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Run what-if crowd simulations: change attendance, gate staffing and walking speed, then compare the day's bottlenecks.",
      },
      { property: "og:title", content: "Crowd Simulation — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "What-if scenarios for attendance, staffing and rerouting across a full race day.",
      },
    ],
  }),
  component: SimulationPage,
});

function runFullDay(params: SimParams) {
  let s = createState();
  const out: { t: number; peak: number; queued: number; hotspots: number }[] = [];
  for (let i = 0; i < 520; i++) {
    s = step(s, params, 1);
    if (i % 5 !== 0) continue;
    let peak = 0;
    for (const z of ZONES) peak = Math.max(peak, density(s, z.id));
    out.push({
      t: s.t,
      peak: Math.round(peak * 100),
      queued: Math.round(queued(s)),
      hotspots: ZONES.filter((z) => density(s, z.id) > 0.78).length,
    });
  }
  return out;
}

function SimulationPage() {
  const { state, params } = useSim();
  const [scenario, setScenario] = useState<SimParams>({ ...params });

  const baseline = useMemo(() => runFullDay(DEFAULT_PARAMS), []);
  const whatIf = useMemo(() => runFullDay(scenario), [scenario]);
  const merged = baseline.map((b, i) => ({
    t: b.t,
    baselinePeak: b.peak,
    scenarioPeak: whatIf[i]?.peak ?? 0,
    baselineQueue: b.queued,
    scenarioQueue: whatIf[i]?.queued ?? 0,
  }));

  const worstBaseline = Math.max(...baseline.map((b) => b.peak));
  const worstScenario = Math.max(...whatIf.map((b) => b.peak));
  const nextHour = forecast(state, params, 60);
  const forecastData = nextHour
    .filter((_, i) => i % 4 === 0)
    .map((f) => ({
      t: f.t,
      ...Object.fromEntries(
        ZONES.slice(0, 6).map((z) => [z.name, Math.round(density(f, z.id) * 100)]),
      ),
    }));

  return (
    <AppShell>
      <PageTitle
        title="Crowd simulation"
        subtitle="Feed in a crowd size and event schedule, then watch how people move through the layout. Everything here is a model — no real attendance data is used."
        right={
          <Button variant="secondary" onClick={() => simActions.setParams(scenario)}>
            Apply scenario to live map
          </Button>
        }
      />

      <div className="mb-4">
        <SimControls />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <div className="panel space-y-6 p-5">
            <div className="label-xs">Scenario inputs</div>
            <Field label="Expected attendance" value={`${scenario.crowdSize.toLocaleString()} people`}>
              <Slider
                min={20000}
                max={160000}
                step={2000}
                value={[scenario.crowdSize]}
                onValueChange={([v]) => setScenario((s) => ({ ...s, crowdSize: v ?? s.crowdSize }))}
              />
            </Field>
            <Field label="Gate staffing" value={`${scenario.staffing.toFixed(2)}× lanes open`}>
              <Slider
                min={0.5}
                max={2}
                step={0.05}
                value={[scenario.staffing]}
                onValueChange={([v]) => setScenario((s) => ({ ...s, staffing: v ?? s.staffing }))}
              />
            </Field>
            <Field label="Pedestrian flow rate" value={`${scenario.flowRate.toFixed(2)}× walking speed`}>
              <Slider
                min={0.5}
                max={1.8}
                step={0.05}
                value={[scenario.flowRate]}
                onValueChange={([v]) => setScenario((s) => ({ ...s, flowRate: v ?? s.flowRate }))}
              />
            </Field>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="label-xs block">Adaptive rerouting</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  Signage & app push people away from hot zones
                </span>
              </span>
              <Switch
                checked={scenario.reroutingEnabled}
                onCheckedChange={(v) => setScenario((s) => ({ ...s, reroutingEnabled: v }))}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setScenario({ ...DEFAULT_PARAMS })}>
                Reset scenario
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setScenario((s) => ({ ...s, crowdSize: 140000, staffing: 0.7 }))}
              >
                Stress test
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Baseline worst density" value={`${worstBaseline}%`} hint="default race day" />
            <Stat
              label="Scenario worst density"
              value={`${worstScenario}%`}
              hint={worstScenario > worstBaseline ? "worse than baseline" : "improved"}
              tone={worstScenario > worstBaseline ? "critical" : "ok"}
            />
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Jump to a moment in the day</div>
            <div className="flex flex-wrap gap-2">
              {EVENT_SCHEDULE.map((e) => (
                <button
                  key={e.t}
                  onClick={() => simActions.jumpTo(e.t)}
                  className="rounded bg-secondary px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  {clockLabel(e.t)} · {e.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel p-4">
            <div className="label-xs mb-3">Full race day · peak zone density (%)</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={merged}>
                  <XAxis dataKey="t" tickFormatter={(t) => clockLabel(t)} stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} width={40} />
                  <Tooltip
                    contentStyle={chartTooltip}
                    labelFormatter={(t) => clockLabel(Number(t))}
                  />
                  <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                  <Line type="monotone" dataKey="baselinePeak" name="Baseline" stroke="var(--color-muted-foreground)" dot={false} strokeDasharray="6 5" />
                  <Line type="monotone" dataKey="scenarioPeak" name="Scenario" stroke="var(--color-chart-1)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Gate queues across the day (people waiting)</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={merged}>
                  <XAxis dataKey="t" tickFormatter={(t) => clockLabel(t)} stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} width={50} />
                  <Tooltip contentStyle={chartTooltip} labelFormatter={(t) => clockLabel(Number(t))} />
                  <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                  <Line type="monotone" dataKey="baselineQueue" name="Baseline" stroke="var(--color-muted-foreground)" dot={false} strokeDasharray="6 5" />
                  <Line type="monotone" dataKey="scenarioQueue" name="Scenario" stroke="var(--color-chart-2)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Next 60 minutes · forecast density by zone (%)</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastData}>
                  <XAxis dataKey="t" tickFormatter={(t) => clockLabel(t)} stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} width={40} />
                  <Tooltip contentStyle={chartTooltip} labelFormatter={(t) => clockLabel(Number(t))} />
                  <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                  {ZONES.slice(0, 6).map((z, i) => (
                    <Line
                      key={z.id}
                      type="monotone"
                      dataKey={z.name}
                      stroke={`var(--color-chart-${(i % 5) + 1})`}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <CircuitMap state={state} params={params} showFacilities={false} />

          <div className="panel p-4">
            <div className="label-xs mb-3">Bottlenecks in the current simulation state</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {detectBottlenecks(state, params)
                .slice(0, 8)
                .map((b) => (
                  <li key={b.id} className="rounded-md bg-surface-2/50 p-3 font-mono text-[11px]">
                    <span className="font-display text-sm text-foreground">{b.name}</span>
                    <div className="mt-1 text-muted-foreground">{b.detail}</div>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

const chartTooltip = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="label-xs">{label}</span>
        <span className="font-mono text-xs">{value}</span>
      </div>
      {children}
    </div>
  );
}
