import { describe, expect, it } from "vitest";
import { easeOutCubic, layerTransform, revealProgress } from "./mapMotion";

describe("map motion", () => {
  it("eases quickly before settling on the target", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("fades map detail across a zoom range", () => {
    expect(revealProgress(1.5, 2, 3)).toBe(0);
    expect(revealProgress(2.5, 2, 3)).toBe(0.5);
    expect(revealProgress(4, 2, 3)).toBe(1);
  });

  it("reprojects a cached layer into a changed map view", () => {
    const transform = layerTransform(
      { scale: 2, offsetX: 100, offsetY: 80 },
      { scale: 3, offsetX: 170, offsetY: 145 },
    );
    expect(transform).toEqual({ scale: 1.5, x: 20, y: 25 });
    expect(40 * transform.scale + transform.x).toBe(80);
    expect(60 * transform.scale + transform.y).toBe(115);
  });
});
