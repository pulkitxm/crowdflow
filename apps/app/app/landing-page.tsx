"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const IMG = {
  hero: "/landing/open-wheel.jpg",
  monaco: "/landing/hero-monaco.jpg",
  pit: "/landing/pit-lane.jpg",
  crowd: "/landing/f1-crowd.jpg",
  car: "/landing/open-wheel.jpg",
  runoff: "/landing/circuit-runoff.jpg",
  formula: "/landing/formula-car.jpg",
} as const;

const NAV = [
  { href: "#features", label: "Capabilities" },
  { href: "#how-it-works", label: "Race weekend" },
  { href: "#infra", label: "Circuits" },
  { href: "#security", label: "Safety" },
  { href: "#pricing", label: "Pricing" },
] as const;

const PROCESS = [
  {
    title: "Define",
    subtitle: "the circuit",
    body: "Load a Grand Prix circuit pack, race-day population, and session timeline. CrowdFlow builds the live mesh across grandstands and egress.",
  },
  {
    title: "Intervene",
    subtitle: "with safety",
    body: "Propose gate holds and spectator reroutes. Every offer is checked against a counterfactual before it reaches fans in the stands.",
  },
  {
    title: "Operate",
    subtitle: "in session",
    body: "Watch sectors, forecasts, and the ops agent through FP, quali, and race. Scale the sim or go live without changing the workflow.",
  },
] as const;

const CIRCUITS = [
  { name: "Silverstone", nodes: "GP weekend" },
  { name: "Monaco", nodes: "Street circuit" },
  { name: "Spa-Francorchamps", nodes: "Ardennes" },
  { name: "Suzuka", nodes: "Figure-8" },
] as const;

const SAFETY = [
  {
    title: "Safety-reviewed offers",
    body: "Reroutes only ship when the safety engine clears them.",
  },
  {
    title: "Counterfactual checks",
    body: "Interventions are scored against what would happen without them.",
  },
  {
    title: "Full audit trails",
    body: "Every forecast, hold, and agent answer is inspectable.",
  },
  {
    title: "Permission boundaries",
    body: "Ops agent stays inside policy — no unsupervised crowd moves.",
  },
] as const;

const PRICING = [
  {
    id: "01",
    name: "Explorer",
    blurb: "For circuit walkthroughs and GP demos",
    price: "$0",
    period: "/month",
    popular: false,
    cta: "Open console",
    features: ["1 F1 circuit pack", "Race-day simulator", "Ops agent answers", "Public Silverstone scenario"],
  },
  {
    id: "02",
    name: "Operator",
    blurb: "For teams running Grand Prix weekends",
    price: "$65",
    period: "/month",
    popular: true,
    cta: "Start trial",
    features: [
      "Full F1 calendar circuits",
      "Live spectator ingest",
      "Safety-reviewed interventions",
      "Team workspaces",
      "Priority support",
    ],
  },
  {
    id: "03",
    name: "Circuit",
    blurb: "For multi-venue F1 operators",
    price: "Custom",
    period: "",
    popular: false,
    cta: "Contact sales",
    features: [
      "Dedicated compute",
      "On-prem deployment",
      "SLA guarantee",
      "Custom mesh policy",
      "24/7 race-weekend support",
    ],
  },
] as const;

function DashboardCta({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href="/dashboard"
      className={
        className ??
        "inline-flex h-8 items-center justify-center rounded-none bg-accent px-6 text-sm font-semibold tracking-wide text-white uppercase transition hover:bg-accent/90"
      }
    >
      {children}
    </Link>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [processStep, setProcessStep] = useState(0);
  const [circuit, setCircuit] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setProcessStep((s) => (s + 1) % PROCESS.length), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setCircuit((r) => (r + 1) % CIRCUITS.length), 2800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <header
        className={`fixed top-0 right-0 left-0 z-50 transition-all duration-500 ${scrolled ? "bg-background/80 backdrop-blur-md" : ""}`}
      >
        <nav className="mx-auto max-w-[1400px] transition-all duration-500">
          <div
            className={`flex items-center justify-between px-6 transition-all duration-500 lg:px-8 ${scrolled ? "h-16" : "h-20"}`}
          >
            <Link href="/" className="group flex items-center gap-2">
              <span
                className={`font-display tracking-tight transition-all duration-500 ${scrolled ? "text-foreground text-xl" : "text-2xl text-white"}`}
              >
                CrowdFlow
              </span>
              <span
                className={`mt-1 font-mono text-xs transition-all duration-500 ${scrolled ? "text-muted-foreground" : "text-white/60"}`}
              >
                TM
              </span>
            </Link>

            <div className="hidden items-center gap-12 md:flex">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`group relative text-sm transition-colors duration-300 ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/70 hover:text-white"}`}
                >
                  {item.label}
                  <span
                    className={`absolute -bottom-1 left-0 h-px w-0 transition-all duration-300 group-hover:w-full ${scrolled ? "bg-foreground" : "bg-white"}`}
                  />
                </a>
              ))}
            </div>

            <div className="hidden items-center gap-4 md:flex">
              <Link
                href="/dashboard"
                className={`text-sm transition-all duration-500 ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/70 hover:text-white"}`}
              >
                Sign in
              </Link>
              <DashboardCta
                className={`inline-flex h-8 items-center justify-center px-6 text-sm font-semibold tracking-wide uppercase transition-all duration-500 ${
                  scrolled
                    ? "bg-asphalt text-accent hover:bg-asphalt/90"
                    : "bg-accent text-white hover:bg-accent/90"
                }`}
              >
                Open console
              </DashboardCta>
            </div>

            <button
              type="button"
              className={`p-2 transition-colors duration-500 md:hidden ${scrolled ? "text-foreground" : "text-white"}`}
              aria-label="Toggle menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
                {menuOpen ? (
                  <>
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </>
                ) : (
                  <>
                    <line x1="4" x2="20" y1="12" y2="12" />
                    <line x1="4" x2="20" y1="6" y2="6" />
                    <line x1="4" x2="20" y1="18" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </nav>

        <div
          className={`fixed inset-0 z-40 bg-background transition-all duration-500 md:hidden ${
            menuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
          style={{ top: 0 }}
        >
          <div className="flex h-full flex-col px-8 pt-28 pb-8">
            <div className="flex flex-1 flex-col justify-center gap-8">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="font-display text-foreground hover:text-muted-foreground text-5xl transition-all"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </div>
            <div className="border-foreground/10 flex gap-4 border-t pt-8">
              <Link
                href="/dashboard"
                className="border-foreground/20 flex h-14 flex-1 items-center justify-center border text-base font-semibold tracking-wide uppercase"
                onClick={() => setMenuOpen(false)}
              >
                Sign in
              </Link>
              <Link
                href="/dashboard"
                className="bg-accent text-white flex h-14 flex-1 items-center justify-center text-base font-semibold tracking-wide uppercase"
                onClick={() => setMenuOpen(false)}
              >
                Open console
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden bg-asphalt">
        <div className="absolute inset-0 z-0 overflow-hidden">
          <img
            src={IMG.hero}
            alt=""
            aria-hidden
            className="hero-zoom h-full w-full object-cover object-[center_40%]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-asphalt via-asphalt/80 to-asphalt/25" />
          <div className="absolute inset-0 bg-gradient-to-t from-asphalt via-asphalt/40 to-transparent" />
          <div className="track-lanes absolute inset-0" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[1400px] px-6 pb-28 pt-32 lg:px-12 lg:pb-32">
          <p className="hero-rise font-display text-[clamp(3.5rem,14vw,9rem)] leading-[0.85] tracking-tight text-white">
            Crowd<span className="text-accent">Flow</span>
          </p>
          <h1 className="hero-rise hero-rise-delay-1 mt-6 max-w-3xl font-display text-[clamp(1.75rem,4.5vw,3.75rem)] leading-[0.95] tracking-tight text-white">
            Keep F1 crowds moving.
          </h1>
          <p className="hero-rise hero-rise-delay-2 mt-5 max-w-xl text-lg leading-relaxed text-white/70 md:text-xl">
            Live grandstand forecasts and safety-reviewed interventions for Formula 1 circuit
            weekends — from Silverstone to Monaco.
          </p>
          <div className="hero-rise hero-rise-delay-3 mt-10 flex flex-wrap gap-3">
            <DashboardCta className="inline-flex h-14 items-center justify-center bg-accent px-10 text-base font-semibold tracking-wide text-white uppercase transition hover:bg-[#ff1a0a]">
              Open operator console
            </DashboardCta>
            <a
              href="#how-it-works"
              className="inline-flex h-14 items-center justify-center border border-white/35 bg-white/5 px-10 text-base font-semibold tracking-wide text-white uppercase backdrop-blur-sm transition hover:border-white hover:bg-white/10"
            >
              Race weekend flow
            </a>
          </div>
        </div>

        <div className="curb-stripe absolute right-0 bottom-0 left-0 z-20 h-3" />
      </section>

      <section id="features" className="relative overflow-hidden py-24 lg:py-32">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="relative mb-24 lg:mb-32">
            <div className="grid items-end gap-8 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <span className="text-muted-foreground mb-6 inline-flex items-center gap-3 font-mono text-sm">
                  <span className="bg-foreground/30 h-px w-12" />
                  Capabilities
                </span>
                <h2 className="font-display text-6xl leading-[0.9] tracking-tight md:text-7xl lg:text-[128px]">
                  Race control
                  <br />
                  <span className="text-muted-foreground">for crowds.</span>
                </h2>
              </div>
              <div className="lg:col-span-5 lg:pb-4">
                <p className="text-muted-foreground text-xl leading-relaxed">
                  Predict grandstand congestion on F1 circuits, evaluate interventions against a
                  counterfactual, and only offer reroutes that pass a safety review.
                </p>
              </div>
            </div>
          </div>

          <div className="group relative flex min-h-[500px] overflow-hidden border border-foreground/10 bg-asphalt transition-all duration-700">
            <div className="relative flex-1 bg-asphalt p-8 lg:p-12">
              <span className="text-muted-foreground font-mono text-sm">01</span>
              <h3 className="font-display mt-4 mb-6 text-3xl text-white transition-transform duration-500 group-hover:translate-x-2 lg:text-4xl">
                Live circuit forecast
              </h3>
              <p className="text-muted-foreground mb-8 max-w-md text-lg leading-relaxed">
                Sector heat, gate pressure, and egress timelines update from the spectator mesh —
                GPS, Wi-Fi, and Bluetooth fused into one race-weekend picture.
              </p>
              <div>
                <span className="font-display text-5xl text-white lg:text-6xl">99.7%</span>
                <span className="text-muted-foreground mt-2 block font-mono text-sm">
                  forecast hit rate
                </span>
              </div>
            </div>
            <div className="relative hidden w-[42%] shrink-0 overflow-hidden lg:block">
              <img
                src={IMG.crowd}
                alt="F1 fans in the grandstands"
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-asphalt via-asphalt/40 to-transparent" />
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="relative overflow-hidden bg-asphalt py-24 text-white lg:py-32"
      >
        <div className="pointer-events-none absolute inset-0 track-lanes opacity-30" />
        <div className="relative z-10 mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="mb-0 grid items-end gap-4 lg:grid-cols-2 lg:gap-12">
            <div className="overflow-hidden pb-0 lg:pb-32">
              <span className="mb-8 inline-flex items-center gap-3 font-mono text-sm text-accent">
                <span className="h-px w-12 bg-accent/40" />
                Race weekend
              </span>
              <h2 className="font-display text-6xl leading-[0.85] tracking-tight md:text-7xl lg:text-[128px]">
                <span className="block">Define.</span>
                <span className="block text-white/30">Deploy.</span>
                <span className="block text-white/10">Scale.</span>
              </h2>
            </div>
            <div className="relative h-[320px] overflow-hidden lg:h-[640px]">
              <img
                src={IMG.pit}
                alt="Formula cars and crew in the pit lane"
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-asphalt via-asphalt/50 to-transparent" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-asphalt via-transparent to-transparent" />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {PROCESS.map((step, i) => {
              const active = processStep === i;
              return (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setProcessStep(i)}
                  className={`relative border bg-black p-8 text-left transition-all duration-500 lg:p-12 ${
                    active ? "border-white/60" : "border-white/25 hover:border-white/50"
                  }`}
                >
                  <div className="mb-8 flex items-center gap-4">
                    <span
                      className={`font-display text-4xl transition-colors duration-300 ${
                        active ? "text-accent" : "text-white/20"
                      }`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="h-px flex-1 overflow-hidden bg-white/10">
                      {active ? <div className="animate-progress h-full bg-accent/50" /> : null}
                    </div>
                  </div>
                  <h3 className="font-display mb-2 text-3xl lg:text-4xl">{step.title}</h3>
                  <span className="font-display mb-6 block text-xl text-white/40">{step.subtitle}</span>
                  <p
                    className={`leading-relaxed text-white/60 transition-opacity duration-300 ${
                      active ? "opacity-100" : "opacity-60"
                    }`}
                  >
                    {step.body}
                  </p>
                  <div
                    className={`absolute right-0 bottom-0 left-0 h-1 origin-left bg-accent transition-transform duration-500 ${
                      active ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section id="infra" className="relative overflow-hidden py-32 lg:py-40">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="mb-20">
            <span className="text-muted-foreground mb-8 inline-flex items-center gap-4 font-mono text-sm">
              <span className="bg-foreground/20 h-px w-12" />
              F1 circuits
            </span>
            <div className="grid items-stretch gap-8 lg:grid-cols-[auto_1fr] lg:gap-16">
              <div className="relative h-56 w-full shrink-0 overflow-hidden border border-foreground/10 sm:h-72 lg:h-auto lg:w-72 xl:w-80">
                <img
                  src={IMG.monaco}
                  alt="Monaco Fairmont Hairpin street circuit"
                  className="h-full w-full object-cover object-center"
                />
              </div>
              <div className="flex flex-col justify-center">
                <h2 className="font-display text-6xl leading-[0.9] tracking-tight md:text-7xl lg:text-[128px]">
                  Built for
                  <br />
                  <span className="text-muted-foreground">Grand Prix.</span>
                </h2>
                <p className="text-muted-foreground mt-8 max-w-lg text-xl leading-relaxed">
                  Circuit packs for the F1 calendar — from Silverstone to Monaco. Sub-50ms path to
                  the operator console when the grandstands fill.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="bg-foreground/[0.02] border-foreground/10 relative overflow-hidden border p-8 lg:col-span-2 lg:p-12">
              <div className="relative z-10">
                <div className="mb-4 flex items-baseline gap-2">
                  <span className="font-display text-8xl leading-none lg:text-[10rem]">24</span>
                  <span className="text-muted-foreground text-2xl">rounds</span>
                </div>
                <p className="text-muted-foreground max-w-md">
                  Model every Grand Prix weekend on the calendar with the same safety-reviewed
                  intervention loop.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <div className="bg-foreground/[0.02] border-foreground/10 border p-8">
                <span className="font-display text-5xl lg:text-6xl">99.99%</span>
                <span className="text-muted-foreground mt-2 block text-sm">Uptime SLA</span>
              </div>
              <div className="bg-foreground/[0.02] border-foreground/10 border p-8">
                <span className="font-display text-5xl lg:text-6xl">&lt;50ms</span>
                <span className="text-muted-foreground mt-2 block text-sm">Live feed latency</span>
              </div>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {CIRCUITS.map((c, i) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setCircuit(i)}
                className={`cursor-default border p-6 text-left transition-all duration-300 ${
                  circuit === i ? "border-accent/50 bg-accent/5" : "border-foreground/10"
                }`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full transition-colors ${
                      circuit === i ? "bg-accent" : "bg-foreground/20"
                    }`}
                  />
                  <span className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
                    circuit
                  </span>
                </div>
                <span className="mb-1 block font-medium">{c.name}</span>
                <span className="text-muted-foreground text-sm">{c.nodes}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-32 lg:py-40">
        <div className="relative z-10 mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="mb-20 grid gap-8 lg:mb-32 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <div className="mb-6 flex items-center gap-4">
                <span className="flex items-center gap-2 bg-accent/15 px-3 py-1 font-mono text-xs text-accent">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  LIVE
                </span>
              </div>
              <h2 className="font-display text-6xl leading-[0.95] tracking-tight md:text-7xl lg:text-[140px]">
                Real-time
                <br />
                <span className="text-muted-foreground">circuit metrics.</span>
              </h2>
            </div>
          </div>
          <div className="relative mb-10 overflow-hidden border border-foreground/10">
            <img
              src={IMG.car}
              alt="Open-wheel car at speed on circuit"
              className="h-auto max-h-[420px] w-full object-cover object-[center_35%]"
            />
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background to-transparent" />
            <div className="absolute right-6 bottom-6 left-6">
              <div className="telemetry-bars h-16 w-full opacity-90" />
            </div>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            <div className="bg-foreground/[0.02] border-foreground/10 border p-10 lg:p-14">
              <div className="font-display mb-4 text-4xl tracking-tight md:text-5xl lg:text-6xl">
                23,847
              </div>
              <div className="text-foreground mb-2 text-lg">Spectators tracked today</div>
              <div className="text-muted-foreground font-mono text-sm">across active F1 circuits</div>
            </div>
            <div className="bg-foreground/[0.02] border-foreground/10 flex flex-col justify-between gap-6 border p-8">
              <div>
                <div className="text-muted-foreground mb-2 font-mono text-sm">across the calendar</div>
                <div className="text-foreground mb-3 text-base">Availability</div>
              </div>
              <div className="font-display text-3xl tracking-tight md:text-4xl lg:text-5xl">99.99%</div>
            </div>
            <div className="bg-foreground/[0.02] border-foreground/10 flex flex-col justify-between gap-6 border p-8">
              <div>
                <div className="text-muted-foreground mb-2 font-mono text-sm">p99 latency</div>
                <div className="text-foreground mb-3 text-base">Live feed</div>
              </div>
              <div className="font-display text-3xl tracking-tight md:text-4xl lg:text-5xl">&lt;50ms</div>
            </div>
          </div>
        </div>
      </section>

      <section id="integrations" className="relative overflow-hidden">
        <div className="relative z-10 pt-32 text-center lg:pt-40">
          <span className="text-muted-foreground mb-8 inline-flex items-center justify-center gap-4 font-mono text-sm">
            <span className="bg-foreground/20 h-px w-12" />
            Stack
            <span className="bg-foreground/20 h-px w-12" />
          </span>
          <h2 className="font-display text-6xl leading-[0.9] tracking-tight md:text-7xl lg:text-[128px]">
            Connect
            <br />
            <span className="text-muted-foreground">the paddock.</span>
          </h2>
          <p className="text-muted-foreground mx-auto mt-8 max-w-lg text-xl leading-relaxed">
            Mesh ingest, operator WebSocket, spectator app, and safety agent — one pipeline from
            grandstand to race control.
          </p>
        </div>
        <div className="relative left-1/2 mt-16 w-screen -translate-x-1/2 px-6 lg:px-12">
          <div className="relative mx-auto max-w-[1400px] overflow-hidden border border-foreground/10">
            <img
              src={IMG.formula}
              alt="Formula car on circuit"
              className="h-[280px] w-full object-cover object-center md:h-[420px]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
          </div>
        </div>
        <div className="relative z-10 mx-auto max-w-[1400px] px-6 pb-32 lg:-mt-24 lg:px-12 lg:pb-40">
          <div className="border-foreground/10 flex flex-wrap items-center justify-between gap-8 border-t pt-12">
            <div className="flex flex-wrap gap-12">
              <div className="flex items-baseline gap-3">
                <span className="font-display text-3xl">Mesh</span>
                <span className="text-muted-foreground text-sm">GPS · Wi-Fi · BT</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-3xl">API</span>
                <span className="text-muted-foreground text-sm">HTTP + WebSocket</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-3xl">Agent</span>
                <span className="text-muted-foreground text-sm">Safety-constrained</span>
              </div>
            </div>
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-2 font-mono text-sm transition-colors"
            >
              Open the console
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section id="security" className="relative overflow-hidden py-32 lg:py-40">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="mb-20">
            <span className="text-muted-foreground mb-8 inline-flex items-center gap-4 font-mono text-sm">
              <span className="bg-foreground/20 h-px w-12" />
              Safety
            </span>
            <h2 className="font-display mb-12 text-6xl leading-[0.9] tracking-tight md:text-7xl lg:text-[128px]">
              Autonomous,
              <br />
              <span className="text-muted-foreground">not uncontrolled.</span>
            </h2>
            <p className="text-muted-foreground max-w-2xl text-xl leading-relaxed">
              CrowdFlow only offers spectator moves that pass a safety review. The ops agent is
              powerful but constrained by race-weekend policy.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="border-foreground/10 relative min-h-[400px] overflow-hidden border p-8 lg:col-span-7 lg:p-12">
              <span className="text-muted-foreground font-mono text-sm">Active protection</span>
              <div className="mt-8">
                <span className="font-display text-7xl lg:text-8xl">0</span>
                <span className="text-muted-foreground mt-2 block">Unsafe offers shipped this year</span>
              </div>
              <div className="absolute right-8 bottom-8 left-8 flex flex-wrap gap-2">
                {["SOC 2", "ISO 27001", "GDPR", "Circuit policy"].map((badge) => (
                  <span
                    key={badge}
                    className="border-foreground/10 text-muted-foreground border px-3 py-1 font-mono text-xs"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-4 lg:col-span-5">
              {SAFETY.map((item, i) => (
                <div
                  key={item.title}
                  className={`border p-6 transition-all duration-500 ${
                    i === 0 ? "border-foreground/30 bg-foreground/[0.04]" : "border-foreground/10"
                  }`}
                >
                  <h3 className="mb-1 font-medium">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="developers" className="relative overflow-hidden bg-asphalt py-24 text-white lg:py-32">
        <div className="pointer-events-none absolute inset-0 track-lanes opacity-25" />
        <div className="pointer-events-none absolute right-0 bottom-0 h-[85%] w-[55%]">
          <img
            src={IMG.formula}
            alt=""
            aria-hidden
            className="h-full w-full object-cover object-center opacity-50"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-asphalt via-asphalt/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-asphalt via-transparent to-asphalt" />
        </div>
        <div className="relative z-10 mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="mb-16">
            <span className="mb-6 inline-flex items-center gap-3 font-mono text-sm text-accent">
              <span className="h-px w-8 bg-accent/40" />
              Race control toolkit
            </span>
            <h2 className="font-display text-6xl leading-[0.9] tracking-tight md:text-7xl lg:text-[128px]">
              Code your circuits.
              <br />
              <span className="text-white/40">Or let the agent reason.</span>
            </h2>
          </div>
          <div className="max-w-[50%]">
            <p className="mb-12 max-w-md text-xl leading-relaxed text-white/60">
              Bun monorepo contracts, core simulation, and a TypeScript CLI — define F1 circuits in
              code, then operate them live on race weekend.
            </p>
            <div className="grid grid-cols-2 gap-6">
              {[
                ["TypeScript native", "Shared contracts from schema to console."],
                ["Streaming live feed", "Watch grandstands and forecasts in real time."],
                ["Safety agent", "Constrained answers for operators on shift."],
                ["Local simulation", "Seed Silverstone A/B before the GP."],
              ].map(([title, body]) => (
                <div key={title}>
                  <h3 className="mb-1 font-medium text-white">{title}</h3>
                  <p className="text-sm text-white/50">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="relative py-32 lg:py-40">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
          <div className="mb-20 grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <span className="text-muted-foreground mb-8 inline-flex items-center gap-3 font-mono text-sm">
                <span className="bg-foreground/30 h-px w-12" />
                Pricing
              </span>
              <h2 className="font-display text-6xl leading-[0.9] tracking-tight md:text-7xl lg:text-[128px]">
                Pay for
                <br />
                <span className="text-stroke">results.</span>
              </h2>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 lg:gap-0">
            {PRICING.map((plan) => (
              <div
                key={plan.id}
                className={`relative border bg-background transition-all duration-700 lg:first:-mr-2 lg:last:-ml-2 ${
                  plan.popular
                    ? "border-foreground/40 z-10 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
                    : "border-foreground/10"
                }`}
              >
                {plan.popular ? (
                  <span className="absolute top-4 right-4 font-mono text-[10px] tracking-widest text-accent uppercase">
                    Most Popular
                  </span>
                ) : null}
                <div className="p-8 lg:p-10">
                  <div className="border-foreground/10 mb-8 border-b pb-8">
                    <span className="text-muted-foreground font-mono text-xs">{plan.id}</span>
                    <h3 className="font-display mt-2 text-2xl lg:text-3xl">{plan.name}</h3>
                    <p className="text-muted-foreground mt-2 text-sm">{plan.blurb}</p>
                  </div>
                  <div className="mb-8">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-5xl lg:text-6xl">{plan.price}</span>
                      {plan.period ? (
                        <span className="text-muted-foreground text-sm">{plan.period}</span>
                      ) : null}
                    </div>
                  </div>
                  <ul className="mb-10 space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-3">
                        <svg
                          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        <span className="text-muted-foreground text-sm">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <DashboardCta
                    className={`inline-flex h-12 w-full items-center justify-center text-sm font-semibold tracking-wide uppercase transition ${
                      plan.popular
                        ? "bg-accent text-white hover:bg-accent/90"
                        : "border-foreground/20 hover:border-accent hover:text-white hover:bg-accent border"
                    }`}
                  >
                    {plan.cta}
                  </DashboardCta>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-asphalt py-32 text-white lg:py-40">
        <div className="pointer-events-none absolute inset-0 track-lanes opacity-40" />
        <div className="relative z-10 mx-auto max-w-[1400px] px-6 text-center lg:px-12">
          <h2 className="font-display mb-8 text-5xl leading-[0.95] tracking-tight md:text-6xl lg:text-8xl">
            Ready for
            <br />
            <span className="text-accent">race weekend?</span>
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-lg text-white/60">
            Join F1 circuit operators running live grandstand forecasts and safety-reviewed
            interventions. Open the console in minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <DashboardCta className="inline-flex h-14 items-center justify-center bg-accent px-10 text-base font-semibold tracking-wide text-white uppercase transition hover:bg-accent/90">
              Open operator console
            </DashboardCta>
            <Link
              href="/simulator"
              className="inline-flex h-14 items-center justify-center border border-white/30 px-10 text-base font-semibold tracking-wide text-white uppercase transition hover:border-accent hover:text-accent"
            >
              Try Silverstone sim
            </Link>
          </div>
          <p className="mt-8 font-mono text-xs text-white/40">
            Free Silverstone GP scenario included
          </p>
        </div>
      </section>

      <footer className="border-foreground/10 border-t py-12">
        <div className="text-muted-foreground mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-6 px-6 sm:flex-row sm:items-center lg:px-12">
          <div className="flex items-center gap-2">
            <span className="font-display text-foreground text-xl">CrowdFlow</span>
            <span className="font-mono text-xs">TM</span>
          </div>
          <div className="flex flex-wrap gap-8 text-sm">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">
              Console
            </Link>
            <Link href="/simulator" className="hover:text-foreground transition-colors">
              Simulator
            </Link>
            <a href="#security" className="hover:text-foreground transition-colors">
              Safety
            </a>
          </div>
          <span className="font-mono text-xs">© {new Date().getFullYear()} CrowdFlow</span>
        </div>
      </footer>
    </main>
  );
}
