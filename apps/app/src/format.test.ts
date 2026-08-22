/**
 * Formatting failure modes.
 *
 * Every case here is a way of turning "we do not know" into a number that looks
 * like knowledge. They are cheap to get wrong — `toFixed` on undefined throws,
 * `Number(null)` is 0 — and expensive to notice, because a zero on a wall reads
 * as calm.
 */
import { describe, expect, it } from "vitest";
import { NO_VALUE, age, clock, countdown, fixed, integer, milliseconds, percent, signed } from "./format";

describe("absent values", () => {
  it("never render as zero", () => {
    for (const render of [fixed, integer, percent, signed, clock, countdown, age, milliseconds]) {
      expect(render(null)).toBe(NO_VALUE);
      expect(render(undefined)).toBe(NO_VALUE);
      expect(render(Number.NaN)).toBe(NO_VALUE);
    }
  });
});

describe("countdown", () => {
  it("is the headline format: T- minutes and seconds", () => {
    expect(countdown(167)).toBe("T-02:47");
    expect(countdown(3725)).toBe("T-1:02:05");
  });

  it("distinguishes 'now' from 'not projected to cross'", () => {
    // Zero means the threshold is already met; null means the forecast does not
    // project a crossing inside its horizon. Rendering both as 00:00 would turn
    // "nothing is coming" into "it is happening".
    expect(countdown(0)).toBe("NOW");
    expect(countdown(null)).toBe(NO_VALUE);
  });
});

describe("clock", () => {
  it("pads so a column does not shift as digits appear", () => {
    expect(clock(9)).toBe("00:09");
    expect(clock(69)).toBe("01:09");
    expect(clock(600)).toBe("10:00");
  });
});

describe("numbers", () => {
  it("keeps a fixed number of decimals", () => {
    expect(fixed(2, 2)).toBe("2.00");
    expect(fixed(0.6666, 2)).toBe("0.67");
  });

  it("signs deltas, because +40s and -40s are opposite recommendations", () => {
    expect(signed(40)).toBe("+40.0");
    expect(signed(-40)).toBe("-40.0");
    expect(signed(0)).toBe("+0.0");
  });

  it("renders percentages from fractions", () => {
    expect(percent(0.184)).toBe("18%");
    expect(percent(0.184, 1)).toBe("18.4%");
  });

  it("scales tick cost into a readable unit", () => {
    expect(milliseconds(29)).toBe("29ms");
    expect(milliseconds(8500)).toBe("8.5s");
  });
});
