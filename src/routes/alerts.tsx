import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { SimControls } from "@/components/SimControls";
import { Button } from "@/components/ui/button";
import { useSim } from "@/lib/sim-store";
import { detectBottlenecks, predictRisks, recommendations } from "@/lib/sim";
import { clockLabel } from "@/lib/venue";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts & Actions — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Bottleneck alerts, predicted pile-ups and the recommended operational action for each one.",
      },
      { property: "og:title", content: "Alerts & Actions — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "Detect crowd pile-ups before they become dangerous and dispatch the fix.",
      },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const { state, params } = useSim();
  const [acked, setAcked] = useState<string[]>([]);
  const bottlenecks = detectBottlenecks(state, params);
  const recs = recommendations(state, params);
  const risks = predictRisks(state, params);

  const counts = {
    critical: bottlenecks.filter((b) => b.severity === "critical").length,
    warning: bottlenecks.filter((b) => b.severity === "warning").length,
    watch: bottlenecks.filter((b) => b.severity === "watch").length,
  };

  return (
    <AppShell>
      <PageTitle
        title="Alerts & actions"
        subtitle="Bottlenecks the system has detected right now, pile-ups it expects in the next 45 minutes, and the action it recommends for each."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Critical" value={String(counts.critical)} tone="critical" hint="act immediately" />
        <Stat label="Warning" value={String(counts.warning)} tone="warning" hint="act within 10 min" />
        <Stat label="Watch" value={String(counts.watch)} hint="monitoring" />
        <Stat label="Acknowledged" value={String(acked.length)} tone="ok" hint="this session" />
      </div>

      <div className="mb-4">
        <SimControls />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="label-xs mb-3">Active alerts</div>
          {bottlenecks.length === 0 && (
            <p className="font-mono text-xs text-muted-foreground">Nothing above threshold.</p>
          )}
          <ul className="space-y-3">
            {bottlenecks.map((b) => {
              const isAcked = acked.includes(b.id);
              return (
                <li
                  key={b.id}
                  className="rounded-md border border-border p-3"
                  style={{ borderLeft: `3px solid var(--color-${b.severity})`, opacity: isAcked ? 0.55 : 1 }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display">{b.name}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                      {b.kind}
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
                      style={{ background: `var(--color-${b.severity})`, color: "var(--color-background)" }}
                    >
                      {b.severity}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {clockLabel(state.t)}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{b.detail}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isAcked}
                      onClick={() => {
                        setAcked((a) => [...a, b.id]);
                        toast.success(`Acknowledged: ${b.name}`);
                      }}
                    >
                      {isAcked ? "Acknowledged" : "Acknowledge"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => toast(`Stewards dispatched to ${b.name}`, { description: "Mock dispatch — no real radio call sent." })}
                    >
                      Dispatch stewards
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="panel p-4">
            <div className="label-xs mb-3">Predicted pile-ups (next 45 min)</div>
            <ul className="space-y-2">
              {risks.length === 0 && (
                <li className="font-mono text-xs text-muted-foreground">No zone forecast above 70% density.</li>
              )}
              {risks.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-md bg-surface-2/50 p-3">
                  <span className="font-display text-sm">{r.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    peak {Math.round(r.peak * 100)}% at {clockLabel(state.t + r.atMinute)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Recommended actions</div>
            <ul className="space-y-3">
              {recs.map((r) => (
                <li key={r.id} className="rounded-md border-l-2 border-accent bg-surface-2/40 p-3">
                  <div className="font-display text-sm">{r.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.body}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="font-mono text-[11px] text-accent">{r.impact}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="ml-auto"
                      onClick={() => toast.success("Action applied", { description: r.title })}
                    >
                      Apply
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
