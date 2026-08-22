/**
 * Number and time rendering.
 *
 * Live timing conventions: fixed decimal places so a column does not jitter as
 * digits appear, monospaced tabular figures so the eye can compare rows without
 * reading them, and an explicit dash for "no value" — never a zero, never a
 * blank. A blank cell reads as calm; an absent measurement is not calm.
 */

/** What every absent value renders as. One glyph, unmistakable, never zero. */
export const NO_VALUE = "—";

export function fixed(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return value.toFixed(dp);
}

export function integer(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return Math.round(value).toLocaleString("en-GB");
}

export function percent(value: number | null | undefined, dp = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${(value * 100).toFixed(dp)}%`;
}

export function signed(value: number | null | undefined, dp = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${value >= 0 ? "+" : ""}${value.toFixed(dp)}`;
}

/** Session clock, H:MM:SS from the start of the scenario. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return NO_VALUE;
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Time to an event, as a countdown.
 *
 * The headline of the prediction panel. `null` is not zero and not "soon" — it
 * means the threshold is not projected to be crossed inside the horizon, which
 * is a different statement and gets a different glyph.
 */
export function countdown(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return NO_VALUE;
  if (seconds <= 0) return "NOW";
  return `T-${clock(seconds)}`;
}

/** Age of something, in the shortest honest unit. */
export function age(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return NO_VALUE;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 120) return `${Math.round(seconds)}s`;
  return clock(seconds);
}

export function milliseconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NO_VALUE;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
