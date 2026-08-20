
const SECONDS_PER_MINUTE = 60;

export function journeyMinutes(seconds: number): number {
  return Math.round(seconds / SECONDS_PER_MINUTE);
}

export function costMinutes(seconds: number): number {
  return Math.ceil(seconds / SECONDS_PER_MINUTE);
}

export function journeyText(seconds: number): string {
  const m = journeyMinutes(seconds);
  return m < 1 ? 'under a minute' : `${m} min`;
}

export function costText(seconds: number): string {
  if (seconds === 0) return 'no extra time';
  const magnitude = Math.ceil(Math.abs(seconds) / SECONDS_PER_MINUTE);
  return `${seconds > 0 ? '+' : '−'}${magnitude} min`;
}

export function minutesUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / SECONDS_PER_MINUTE));
}

export function untilText(at: number, now: number): string {
  const m = minutesUntil(at, now);
  return m < 1 ? 'now' : `${m} min`;
}

export function freshnessText(updatedAt: number, now: number): string {
  const age = Math.max(0, now - updatedAt);
  const m = Math.floor(age / SECONDS_PER_MINUTE);
  if (m < 1) return 'Updated just now';
  if (m === 1) return 'Updated a minute ago';
  return `Updated ${m} minutes ago`;
}
