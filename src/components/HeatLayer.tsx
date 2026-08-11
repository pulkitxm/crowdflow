import { useEffect, useRef } from "react";
import { computeHeatField, GRID_H, GRID_W, heatColor, type HeatField } from "@/lib/heat";
import type { SimState } from "@/lib/sim";

interface Props {
  state: SimState;
  onField?: (field: HeatField) => void;
  className?: string;
}

/** Output resolution of the upscaled thermal image. */
const OUT_W = 1000;
const OUT_H = 640;

/**
 * Draws the crowd-density field as a continuous thermal image: the coarse
 * density grid is painted into a tiny buffer, then resampled up to map size
 * with smoothing plus a light blur so the result is one flowing surface rather
 * than a cluster of dots.
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

    const buf = document.createElement("canvas");
    buf.width = GRID_W;
    buf.height = GRID_H;
    const bctx = buf.getContext("2d");
    if (!bctx) return;
    const img = bctx.createImageData(GRID_W, GRID_H);
    for (let i = 0; i < field.grid.length; i++) {
      const [r, g, b, a] = heatColor(field.grid[i] ?? 0);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = a;
    }
    bctx.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, OUT_W, OUT_H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = "blur(5px)";
    ctx.drawImage(buf, 0, 0, OUT_W, OUT_H);
    ctx.filter = "none";

    cb.current?.(field);
  }, [state]);

  return (
    <canvas
      ref={ref}
      width={OUT_W}
      height={OUT_H}
      aria-hidden
      className={className}
      style={{ imageRendering: "auto" }}
    />
  );
}
