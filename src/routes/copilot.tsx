import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageTitle, Stat } from "@/components/AppShell";
import { SimControls } from "@/components/SimControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSim } from "@/lib/sim-store";
import { askCopilot, briefing, SUGGESTED_QUESTIONS, type CopilotAnswer } from "@/lib/copilot";
import { clockLabel } from "@/lib/venue";

export const Route = createFileRoute("/copilot")({
  head: () => ({
    meta: [
      { title: "Ops Copilot — Crowd Flow Optimiser" },
      {
        name: "description",
        content:
          "Ask the crowd model plain-language questions and get the answer, the numbers behind it and the action to take.",
      },
      { property: "og:title", content: "Ops Copilot — Crowd Flow Optimiser" },
      {
        property: "og:description",
        content: "A control-room assistant that reads the live crowd simulation and briefs your team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CopilotPage,
});

interface Turn {
  q: string;
  a: CopilotAnswer;
  at: number;
}

function CopilotPage() {
  const { state, params } = useSim();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  const ask = (q: string) => {
    if (!q.trim()) return;
    setTurns((t) => [{ q, a: askCopilot(q, state, params), at: state.t }, ...t].slice(0, 12));
    setInput("");
  };

  return (
    <AppShell>
      <PageTitle
        title="Ops copilot"
        subtitle="Plain-language answers grounded in the live simulation — no dashboard hunting during an incident."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Questions asked" value={String(turns.length)} hint="this session" />
        <Stat label="Model clock" value={clockLabel(state.t)} />
        <Stat label="Rerouting" value={params.reroutingEnabled ? "ON" : "OFF"} tone={params.reroutingEnabled ? "ok" : "warning"} />
      </div>

      <div className="mb-4">
        <SimControls />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="panel p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about crowds, gates, risks or evacuation…"
                className="font-mono text-xs"
              />
              <Button type="submit">Ask</Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {turns.length === 0 && (
            <div className="panel p-6 text-sm text-muted-foreground">
              Ask anything about the current crowd picture. Every answer is computed from the running
              simulation, so it changes minute by minute.
            </div>
          )}

          {turns.map((t, i) => (
            <div key={`${t.at}-${i}`} className="panel p-4">
              <div className="flex items-center gap-2">
                <span className="font-display text-sm">{t.q}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  asked at {clockLabel(t.at)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{t.a.text}</p>
              {t.a.facts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.a.facts.map((f) => (
                    <span
                      key={f.label}
                      className="rounded-md bg-surface-2/60 px-2 py-1 font-mono text-[11px]"
                    >
                      <span className="text-muted-foreground">{f.label}:</span> {f.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="panel p-4">
            <div className="label-xs mb-2">Auto shift briefing</div>
            <p className="text-sm leading-relaxed">{briefing(state, params)}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => navigator.clipboard?.writeText(briefing(state, params))}
            >
              Copy briefing
            </Button>
          </div>
          <div className="panel p-4">
            <div className="label-xs mb-2">How it works</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The copilot reads the same state the map renders: per-zone density, walkway flow, gate
              queues and the 45-minute forecast. It picks the relevant slice for your question and
              writes it up, so the numbers in the answer always match the dashboard.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
