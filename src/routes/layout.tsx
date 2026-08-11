import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { CircuitMap } from "@/components/CircuitMap";
import { Button } from "@/components/ui/button";
import { simActions, useSim } from "@/lib/sim-store";
import { edgeKey } from "@/lib/sim";
import { EDGES, EVENT_SCHEDULE, FACILITIES, GATES, NODE_MAP, ZONES, clockLabel } from "@/lib/venue";

export const Route = createFileRoute("/layout")({
  head: () => ({
    meta: [
      { title: "Venue Layout — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "The venue layout the simulation runs on: entry gates, walkways, concession points, emergency routes and the event schedule.",
      },
      { property: "og:title", content: "Venue Layout — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "Gates, walkways, concessions and emergency exits that feed the crowd model.",
      },
    ],
  }),
  component: LayoutPage,
});

function LayoutPage() {
  const { state, params } = useSim();
  const closed = params.closedEdges;

  return (
    <AppShell>
      <PageTitle
        title="Venue layout"
        subtitle="This is the input to the model: gates, walkways, concession points and emergency exits. Close a walkway and the simulation immediately reroutes around it."
        right={
          <Button
            variant="secondary"
            onClick={() => {
              simActions.setParams({ closedEdges: [] });
              toast.success("All walkways reopened");
            }}
          >
            Reopen all walkways
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Entry / exit gates" value={String(GATES.length)} hint={`${GATES.reduce((s, g) => s + g.capacity, 0).toLocaleString()} people/hr combined`} />
        <Stat label="Crowd zones" value={String(ZONES.length)} hint="grandstands, concourses, paddock" />
        <Stat label="Walkways" value={String(EDGES.length)} hint={`${closed.length} closed`} tone={closed.length ? "warning" : "default"} />
        <Stat label="Facilities" value={String(FACILITIES.length)} hint="food, toilets, medical, screens" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <CircuitMap state={state} params={params} showFlows={false} />

        <div className="space-y-4">
          <div className="panel p-4">
            <div className="label-xs mb-3">Walkway network</div>
            <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
              {EDGES.map((e) => {
                const key = edgeKey(e.a, e.b);
                const isClosed = closed.includes(key);
                return (
                  <li key={key} className="flex items-center gap-2 rounded bg-surface-2/40 px-3 py-2 font-mono text-[11px]">
                    <span className={isClosed ? "text-muted-foreground line-through" : ""}>
                      {NODE_MAP[e.a]?.name} ↔ {NODE_MAP[e.b]?.name}
                    </span>
                    <span className="ml-auto text-muted-foreground">{e.throughput}/min</span>
                    <button
                      onClick={() => {
                        simActions.toggleEdge(key);
                        toast(isClosed ? "Walkway reopened" : "Walkway closed", {
                          description: `${NODE_MAP[e.a]?.name} ↔ ${NODE_MAP[e.b]?.name}`,
                        });
                      }}
                      className={`rounded px-2 py-0.5 uppercase ${
                        isClosed ? "bg-critical text-background" : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {isClosed ? "closed" : "open"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Entry gates</div>
            <ul className="space-y-1">
              {GATES.map((g) => (
                <li key={g.id} className="flex items-center gap-3 rounded bg-surface-2/40 px-3 py-2 font-mono text-[11px]">
                  <span>{g.name}</span>
                  <span className="ml-auto text-muted-foreground">{g.capacity.toLocaleString()}/hr</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Facilities</div>
            <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-1">
              {FACILITIES.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded bg-surface-2/40 px-3 py-2 font-mono text-[11px]">
                  <span>{f.name}</span>
                  <span className="ml-auto uppercase text-muted-foreground">{f.facility}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-4">
            <div className="label-xs mb-3">Event schedule (drives crowd intent)</div>
            <ul className="space-y-1">
              {EVENT_SCHEDULE.map((e) => (
                <li key={e.t} className="flex items-center gap-3 rounded bg-surface-2/40 px-3 py-2 font-mono text-[11px]">
                  <span className="text-muted-foreground">{clockLabel(e.t)}</span>
                  <span>{e.label}</span>
                  <span className="ml-auto text-muted-foreground">
                    {e.magnet.map((m) => NODE_MAP[m]?.name ?? m).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
