import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Radio,
  ShieldAlert,
  Smartphone,
  LayoutGrid,
  Flag,
  Map,
  Route as RouteIcon,
  SlidersHorizontal,
} from "lucide-react";
import { useSim } from "@/lib/sim-store";
import { CircuitPicker } from "./CircuitPicker";
import { CIRCUIT_SPECS, clockLabel, scheduleAt } from "@/lib/venue";
import { detectBottlenecks, inside, queued } from "@/lib/sim";

const NAV = [
  { to: "/", label: "Live Map", icon: Map },
  { to: "/zones", label: "Zones", icon: LayoutGrid },
  { to: "/alerts", label: "Alerts", icon: AlertTriangle },
  { to: "/routing", label: "Rerouting", icon: RouteIcon },
  { to: "/simulation", label: "Simulation", icon: Activity },
  { to: "/evacuation", label: "Evacuation", icon: ShieldAlert },
  { to: "/copilot", label: "Copilot", icon: Bot },
  { to: "/spectator", label: "Spectator", icon: Smartphone },
  { to: "/feeds", label: "Feeds", icon: Radio },
  { to: "/reports", label: "Report", icon: BarChart3 },
  { to: "/layout", label: "Layout", icon: SlidersHorizontal },
  { to: "/circuits", label: "Circuits", icon: Flag },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { state, params, playing, circuitId } = useSim();
  const circuit = CIRCUIT_SPECS.find((c) => c.id === circuitId) ?? CIRCUIT_SPECS[0]!;
  const alerts = detectBottlenecks(state, params).filter(
    (b) => b.severity === "critical" || b.severity === "warning",
  ).length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <Link to="/" className="flex min-w-0 items-center gap-3">
              <div className="h-8 w-2 shrink-0 stripe-accent rounded-sm" />
              <div className="min-w-0">
                <div className="truncate font-display text-base leading-none tracking-wide sm:text-lg">
                  CROWD FLOW OPTIMISER
                </div>
                <div className="label-xs mt-1 hidden truncate sm:block">{circuit.name} · mock control room</div>
              </div>
            </Link>

            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <CircuitPicker />
              <StatusPill live={playing} />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 overflow-x-auto no-scrollbar font-mono text-xs">
            <HeadStat label="Clock" value={clockLabel(state.t)} />
            <HeadStat label="Inside" value={Math.round(inside(state)).toLocaleString()} />
            <HeadStat label="Queueing" value={Math.round(queued(state)).toLocaleString()} />
            <HeadStat label="Now" value={scheduleAt(state.t).label} />
          </div>

          <nav className="mt-2 flex gap-1 overflow-x-auto no-scrollbar pb-2">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground sm:px-3 sm:text-xs"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
                {to === "/alerts" && alerts > 0 && (
                  <span className="rounded bg-critical px-1.5 font-mono text-[10px] text-background">
                    {alerts}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6 sm:py-6">{children}</main>
      <footer className="mx-auto max-w-[1600px] px-3 py-8 sm:px-6">
        <p className="label-xs">
          Prototype · all crowd data is simulated, no live feeds connected
        </p>
      </footer>
    </div>
  );
}

function HeadStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="shrink-0 whitespace-nowrap">
      <span className="label-xs">{label}</span>{" "}
      <span className="text-sm">{value}</span>
    </div>
  );
}


function StatusPill({ live }: { live: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-border px-2 py-1 font-mono text-[11px] sm:px-3 sm:text-xs">
      <span
        className={`h-2 w-2 rounded-full ${live ? "bg-ok" : "bg-muted-foreground"}`}
      />
      {live ? "LIVE" : "PAUSED"}
    </span>
  );
}

export function PageTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl uppercase tracking-wide sm:text-3xl">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warning" | "critical";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "warning"
        ? "text-warning"
        : tone === "critical"
          ? "text-critical"
          : "text-foreground";
  return (
    <div className="panel min-w-0 p-3 sm:p-4">
      <div className="label-xs truncate">{label}</div>
      <div className={`mt-1.5 truncate font-display text-xl sm:mt-2 sm:text-2xl ${toneClass}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
