import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useSim } from "@/lib/sim-store";
import { density, detectBottlenecks, routeBetween } from "@/lib/sim";
import { FACILITIES, GATES, NODE_MAP, ZONES, clockLabel, scheduleAt } from "@/lib/venue";

export const Route = createFileRoute("/spectator")({
  head: () => ({
    meta: [
      { title: "Spectator Companion — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "The attendee view: personalised quiet routes, live queue times and push nudges away from crowded areas.",
      },
      { property: "og:title", content: "Spectator Companion — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "How rerouting advice actually reaches people — a mock spectator app fed by the optimiser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SpectatorPage,
});

function SpectatorPage() {
  const { state, params } = useSim();
  const [seat, setSeat] = useState(ZONES[0]?.id ?? "");
  const destinations = [
    ...FACILITIES.slice(0, 6),
    ...ZONES.slice(0, 4),
    ...GATES.slice(0, 3),
  ];
  const [dest, setDest] = useState(destinations[0]?.id ?? "");
  const route = routeBetween(state, params, seat, dest);
  const saved = route.direct.minutes - route.optimised.minutes;
  const bns = detectBottlenecks(state, params);

  const nudges = [
    ...bns.slice(0, 2).map((b) => ({
      id: b.id,
      tone: b.severity,
      title: `${b.name} is busy`,
      body:
        b.kind === "gate"
          ? "Use a different gate — we've marked the quickest one on your map."
          : "We've re-routed your walking directions around it.",
    })),
    {
      id: "sched",
      tone: "ok" as const,
      title: scheduleAt(state.t).label,
      body: `Now on at ${clockLabel(state.t)}. Head back to your stand 10 minutes early to avoid the surge.`,
    },
  ];

  const facilityWaits = FACILITIES.slice(0, 6).map((f) => {
    const d = density(state, f.id);
    return { f, wait: Math.round(1 + d * 18) };
  });

  return (
    <AppShell>
      <PageTitle
        title="Spectator companion"
        subtitle="Rerouting only works if it reaches people. This is the attendee-facing side of the system: personalised quiet routes, live queue times and nudges pushed straight to their phone."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="panel overflow-hidden p-3">
          <div className="rounded-2xl border border-border bg-surface-2/60 p-4">
            <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
              <span>{clockLabel(state.t)}</span>
              <span>LIVE GUIDANCE</span>
            </div>
            <div className="mt-3 font-display text-lg uppercase tracking-wide">
              {NODE_MAP[dest]?.name ?? dest}
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              from {NODE_MAP[seat]?.name ?? seat}
            </div>

            <div className="mt-4 rounded-xl bg-background p-3">
              <div className="font-display text-3xl text-accent">
                {route.optimised.minutes.toFixed(0)} min
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                quiet route · {saved > 0.3 ? `${saved.toFixed(0)} min faster than the direct line` : "shortest way is also the calmest"}
              </div>
              <ol className="mt-3 space-y-2">
                {route.optimised.path.map((p, i) => (
                  <li key={p} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px]">
                      {i + 1}
                    </span>
                    {NODE_MAP[p]?.name ?? p}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-4 space-y-2">
              {nudges.map((n) => (
                <div
                  key={n.id}
                  className="rounded-lg border-l-2 bg-background p-3"
                  style={{ borderColor: `var(--color-${n.tone === "ok" ? "accent" : n.tone})` }}
                >
                  <div className="font-display text-xs">{n.title}</div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{n.body}</p>
                </div>
              ))}
            </div>

            <Button
              className="mt-4 w-full"
              onClick={() =>
                toast.success("Push sent to 41,208 opted-in spectators", {
                  description: "Mock broadcast — quiet-route guidance updated in the app.",
                })
              }
            >
              Push this guidance
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel p-4">
            <div className="label-xs mb-3">Simulate an attendee</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="label-xs mb-1">Their seat / zone</div>
                <select
                  value={seat}
                  onChange={(e) => setSeat(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs"
                >
                  {ZONES.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="label-xs mb-1">Where they want to go</div>
                <select
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs"
                >
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Live queue times shown in the app</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {facilityWaits.map(({ f, wait }) => (
                <li key={f.id} className="flex items-center gap-3 rounded-md bg-surface-2/50 p-3">
                  <span className="font-display text-sm">{f.name}</span>
                  <span
                    className="ml-auto font-mono text-xs"
                    style={{
                      color:
                        wait > 12 ? "var(--color-critical)" : wait > 7 ? "var(--color-warning)" : "var(--color-ok)",
                    }}
                  >
                    ~{wait} min
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-2">Why this matters</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Signage moves the crowd slowly; phones move it immediately. Every recommendation the
              control room applies is mirrored here, so the people creating the bottleneck are the ones
              told how to avoid it.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
