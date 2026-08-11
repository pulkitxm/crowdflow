import { HEAT_BANDS, HEAT_MAX, type HeatField } from "@/lib/heat";

interface Props {
  field?: HeatField | null;
  /** Compact variant drops the band chips (for narrow panels). */
  compact?: boolean;
  className?: string;
}

const gradient = `linear-gradient(90deg, #107a3e 0%, ${HEAT_BANDS.map(
  (b) => `${b.color} ${Math.round((b.value / HEAT_MAX) * 100)}%`,
).join(", ")}, #ffd2d2 100%)`;

/** Reads the band a density value falls into. */
export function bandFor(v: number) {
  let band = HEAT_BANDS[0]!;
  for (const b of HEAT_BANDS) if (v >= b.value) band = b;
  return band;
}

/**
 * Shared legend for the crowd-density heat field: colour ramp with numeric
 * ticks, the named density bands, and the live peak read-out.
 */
export function HeatLegend({ field, compact, className }: Props) {
  const peak = field?.peak ?? 0;
  const peakBand = bandFor(peak);

  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${className ?? ""}`}>
      <div className="min-w-[190px] flex-1">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Crowd density
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">people / m²</span>
        </div>
        <div className="h-3 w-full rounded-full border border-border/60" style={{ background: gradient }} />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>0</span>
          {HEAT_BANDS.slice(0, -1).map((b) => (
            <span key={b.value}>{b.value}</span>
          ))}
          <span>{HEAT_MAX}+</span>
        </div>
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {HEAT_BANDS.map((b) => (
            <span
              key={b.label}
              className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
              {b.label}
              <span className="text-[10px] opacity-60">≥{b.value}</span>
            </span>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2 font-mono text-[11px]">
        <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ background: peakBand.color }}
        />
        <span>
          Peak {field ? peak.toFixed(1) : "—"} p/m²
        </span>
        <span className="text-muted-foreground">
          · {field ? Math.round(field.people).toLocaleString() : "—"} people mapped
        </span>
      </div>
    </div>
  );
}
