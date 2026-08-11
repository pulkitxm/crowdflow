import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { SimControls } from "@/components/SimControls";
import { useSim } from "@/lib/sim-store";
import { buildFeeds, feedSummary, FEED_META, type FeedKind } from "@/lib/feeds";

export const Route = createFileRoute("/feeds")({
  head: () => ({
    meta: [
      { title: "Sensor Feeds — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "The CCTV, Wi-Fi, turnstile and LiDAR inputs the crowd model fuses, with device health and confidence.",
      },
      { property: "og:title", content: "Sensor Feeds — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "Live data sources feeding the crowd simulation, with coverage and latency monitoring.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FeedsPage,
});

const KINDS: FeedKind[] = ["cctv", "wifi", "turnstile", "lidar", "app"];

function FeedsPage() {
  const { state } = useSim();
  const [kind, setKind] = useState<FeedKind | "all">("all");
  const feeds = useMemo(() => buildFeeds(state), [state]);
  const summary = feedSummary(feeds);
  const shown = kind === "all" ? feeds : feeds.filter((f) => f.kind === kind);

  return (
    <AppShell>
      <PageTitle
        title="Sensor feeds"
        subtitle="Everything the model sees. Counts are fused across cameras, Wi-Fi probes, ticket scans and walkway LiDAR — when a device drops out, confidence in that area falls and the model leans on its neighbours."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devices" value={String(summary.total)} />
        <Stat label="Online" value={String(summary.online)} tone="ok" />
        <Stat
          label="Degraded / offline"
          value={`${summary.degraded} / ${summary.offline}`}
          tone={summary.offline ? "warning" : "default"}
        />
        <Stat label="Avg latency" value={`${summary.avgLatency} ms`} hint={`${Math.round(summary.coverage * 100)}% coverage`} />
      </div>

      <div className="mb-4">
        <SimControls />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        {KINDS.map((k) => {
          const list = feeds.filter((f) => f.kind === k);
          return (
            <button
              key={k}
              onClick={() => setKind(kind === k ? "all" : k)}
              className={`panel p-3 text-left transition-colors ${kind === k ? "ring-1 ring-accent" : ""}`}
            >
              <div className="label-xs">{FEED_META[k].label}</div>
              <div className="mt-1 font-display text-xl">{list.length}</div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{FEED_META[k].blurb}</p>
            </button>
          );
        })}
      </div>

      <div className="panel p-3 sm:p-4">
        <div className="label-xs mb-3">
          {kind === "all" ? "All devices" : FEED_META[kind].label} · {shown.length}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left font-mono text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2">Device</th>
                <th>Location</th>
                <th>Reading</th>
                <th>Latency</th>
                <th>Confidence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className="border-t border-border/60">
                  <td className="py-2 text-foreground">{f.name}</td>
                  <td className="text-muted-foreground">{f.location}</td>
                  <td>
                    {f.health === "offline" ? "—" : `${f.value.toLocaleString()} ${f.unit}`}
                  </td>
                  <td className="text-muted-foreground">{f.latencyMs} ms</td>
                  <td>{Math.round(f.confidence * 100)}%</td>
                  <td>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] uppercase"
                      style={{
                        background:
                          f.health === "online"
                            ? "var(--color-ok)"
                            : f.health === "degraded"
                              ? "var(--color-warning)"
                              : "var(--color-critical)",
                        color: "var(--color-background)",
                      }}
                    >
                      {f.health}
                    </span>
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
