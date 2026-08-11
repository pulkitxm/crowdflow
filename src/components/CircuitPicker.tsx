import { ChevronDown } from "lucide-react";
import { simActions, useSim } from "@/lib/sim-store";
import { CIRCUIT_SPECS } from "@/lib/venue";

export function CircuitPicker() {
  const { circuitId } = useSim();
  const active = CIRCUIT_SPECS.find((c) => c.id === circuitId) ?? CIRCUIT_SPECS[0]!;

  return (
    <label className="relative flex min-w-0 items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 sm:px-3">
      <span aria-hidden className="text-base leading-none">
        {active.flag}
      </span>
      <span className="sr-only">Select circuit</span>
      <select
        value={circuitId}
        onChange={(e) => simActions.setCircuit(e.target.value)}
        className="w-[7.5rem] appearance-none truncate bg-transparent pr-5 font-mono text-[11px] uppercase tracking-widest text-foreground outline-none sm:w-auto sm:text-xs"
      >
        {CIRCUIT_SPECS.map((c) => (
          <option key={c.id} value={c.id} className="bg-background text-foreground">
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </label>
  );
}
