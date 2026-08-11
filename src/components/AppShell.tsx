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
  { to: "/spectator", label: "Spectator App", icon: Smartphone },
  { to: "/feeds", label: "Feeds", icon: Radio },
  { to: "/reports", label: "Report", icon: BarChart3 },
  { to: "/layout", label: "Venue Layout", icon: SlidersHorizontal },
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
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="h-8 w-2 stripe-accent rounded-sm" />
            <div>
              <div className="font-display text-lg leading-none tracking-wide">
                CROWD FLOW OPTIMISER
              </div>
              <div className="label-xs mt-1">{circuit.name} · mock control room</div>
            </div>
          </Link>

          <div className="order-2 lg:order-none">
            <CircuitPicker />
          </div>

          <nav className="order-3 flex w-full gap-1 overflow-x-auto lg:order-none lg:w-auto">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {to === "/alerts" && alerts > 0 && (
                  <span className="rounded bg-critical px-1.5 font-mono text-[10px] text-background">
                    {alerts}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-5 font-mono text-xs">
            <StatusPill live={playing} />
            <div>
              <div className="label-xs">Clock</div>
              <div className="text-sm">{clockLabel(state.t)}</div>
            </div>
            <div className="hidden sm:block">
              <div className="label-xs">Inside</div>
              <div className="text-sm">{Math.round(inside(state)).toLocaleString()}</div>
            </div>
            <div className="hidden md:block">
              <div className="label-xs">Queueing</div>
              <div className="text-sm">{Math.round(queued(state)).toLocaleString()}</div>
            </div>
            <div className="hidden xl:block">
              <div className="label-xs">Now</div>
              <div className="text-sm">{scheduleAt(state.t).label}</div>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <p className="label-xs">
          Prototype · all crowd data is simulated, no live feeds connected
        </p>
      </footer>
    </div>
  );
}

function StatusPill({ live }: { live: boolean }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1">
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl uppercase tracking-wide">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {right}
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
    <div className="panel p-4">
      <div className="label-xs">{label}</div>
      <div className={`mt-2 font-display text-2xl ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 font-mono text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
