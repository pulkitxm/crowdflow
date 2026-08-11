import { useEffect, useRef } from "react";
import { computeHeatField, GRID_H, GRID_W, heatColor, type HeatField } from "@/lib/heat";
import type { SimState } from "@/lib/sim";

interface Props {
  state: SimState;
  onField?: (field: HeatField) => void;
  className?: string;
}

/**
 * Draws the crowd-density field as a real heat map: one pixel per grid cell,
 * scaled up by the browser so it reads as a smooth thermal image.
 */
export function HeatLayer({ state, onField, className }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const cb = useRef(onField);
  cb.current = onField;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const field = computeHeatField(state);
    const img = ctx.createImageData(GRID_W, GRID_H);
    for (let i = 0; i < field.grid.length; i++) {
      const [r, g, b, a] = heatColor(field.grid[i] ?? 0);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    cb.current?.(field);
  }, [state]);

  return (
    <canvas
      ref={ref}
      width={GRID_W}
      height={GRID_H}
      aria-hidden
      className={className}
      style={{ imageRendering: "auto" }}
    />
  );
}
