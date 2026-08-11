import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { simActions, useSim } from "@/lib/sim-store";
import { clockLabel } from "@/lib/venue";

export function SimControls() {
  const { playing, speed, state } = useSim();
  return (
    <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <Button size="sm" variant={playing ? "secondary" : "default"} onClick={simActions.togglePlay}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {playing ? "Pause" : "Play"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => simActions.stepOnce(10)}>
        <SkipForward className="h-4 w-4" /> +10 min
      </Button>
      <Button size="sm" variant="secondary" onClick={simActions.reset}>
        <RotateCcw className="h-4 w-4" /> Reset
      </Button>
      <div className="flex items-center gap-1">
        <span className="label-xs mr-1">Speed</span>
        {[1, 2, 5, 10].map((s) => (
          <button
            key={s}
            onClick={() => simActions.setSpeed(s)}
            className={`rounded px-2 py-1 font-mono text-xs ${
              speed === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="ml-auto font-mono text-xs text-muted-foreground">
        T+{Math.round(state.t)} min · {clockLabel(state.t)}
      </span>
    </div>
  );
}
