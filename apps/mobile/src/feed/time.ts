/**
 * Seconds in, minutes out.
 *
 * The app shows minutes and never seconds: a spectator cannot act on a 40-second
 * difference, and a number that changes every tick reads as noise. These are
 * presentation rules, not model thresholds — nothing here classifies the world,
 * it only decides how a duration the engine already computed is spoken aloud.
 *
 * Two rounding rules, and they deliberately differ:
 *
 *   - A JOURNEY rounds to nearest. It is an estimate in both directions and
 *     rounding it up everywhere would make every walk look worse than it is.
 *   - A COST rounds up. If a redirect adds 3 minutes 10 seconds we say 4. The
 *     user is being asked to accept the cost before they can see it, so the
 *     error has to land in their favour. Understating what we are asking for is
 *     how a routing app stops being believed, and a routing app nobody believes
 *     has no sensing mesh behind it.
 */

const SECONDS_PER_MINUTE = 60;

/** Whole minutes for a journey, rounded to nearest. */
export function journeyMinutes(seconds: number): number {
  return Math.round(seconds / SECONDS_PER_MINUTE);
}

/** Whole minutes for something we are asking the user to spend, rounded up. */
export function costMinutes(seconds: number): number {
  return Math.ceil(seconds / SECONDS_PER_MINUTE);
}

/**
 * A journey as words: "12 min", or "under a minute" when rounding to nearest
 * would print a bare "0 min" and look broken.
 */
export function journeyText(seconds: number): string {
  const m = journeyMinutes(seconds);
  return m < 1 ? 'under a minute' : `${m} min`;
}

/** A cost as words, always signed so it reads as an addition: "+4 min". */
export function costText(seconds: number): string {
  const m = costMinutes(seconds);
  return `${seconds >= 0 ? '+' : '−'}${Math.abs(m)} min`;
}

/**
 * A countdown to an absolute unix-second instant.
 *
 * Clamped at zero: a crossing whose stated time has passed reads as "now", never
 * as a negative number. The engine will correct it on the next message; until
 * then "now" is the honest reading of "the time we were given has arrived".
 */
export function minutesUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / SECONDS_PER_MINUTE));
}

/** "4 min" / "now", for crossing timetables. */
export function untilText(at: number, now: number): string {
  const m = minutesUntil(at, now);
  return m < 1 ? 'now' : `${m} min`;
}

/**
 * How old the advice is, in the user's terms.
 *
 * Shown rather than hidden. Under D7 the uplink is opportunistic, so a stale
 * screen is a normal condition and pretending otherwise would train people to
 * trust it when they should not.
 */
export function freshnessText(updatedAt: number, now: number): string {
  const age = Math.max(0, now - updatedAt);
  const m = Math.floor(age / SECONDS_PER_MINUTE);
  if (m < 1) return 'Updated just now';
  if (m === 1) return 'Updated a minute ago';
  return `Updated ${m} minutes ago`;
}
