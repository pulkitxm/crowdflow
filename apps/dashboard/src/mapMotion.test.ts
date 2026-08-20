import { describe, expect, it } from "vitest";
import { easeOutCubic, revealProgress } from "./mapMotion";

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
});
