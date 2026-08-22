import { Simulation } from './model.js';

export const ASSUMED_RAIN_SPEED_FACTOR = 0.78;
export const ASSUMED_RED_FLAG_S = 40 * 60;
export const ASSUMED_MEDICAL_HOLD_S = 12 * 60;

export const ASSUMED_GRIDLOCK_DELAY_S = 35 * 60;
export const ASSUMED_GATE_FAILURE_S = 20 * 60;
export const ASSUMED_CELEBRATION_EXTRA_S = 50 * 60;
export const ASSUMED_CELEBRATION_EXTRA_SHARE = 0.55;
export const ASSUMED_ACCIDENT_EARLY_LEAVE_SHARE = 0.08;

export type AnomalyKind =
  | 'rain'
  | 'red_flag'
  | 'mass_departure'
  | 'track_accident'
  | 'gate_failure'
  | 'inbound_gridlock'
  | 'crowd_medical'
  | 'home_win_celebration';

export interface AnomalySpec {
  kind: AnomalyKind;
  duration_s?: number;
  zone?: string;
}

export interface Anomaly {
  id: string;
  kind: AnomalyKind;
  label: string;
  injected_at_s: number;
  duration_s: number;
  affected_agents: number;
  effect: string;
  zone?: string;
}

export const ANOMALY_CATALOGUE: Array<{ kind: AnomalyKind; label: string; effect: string; default_duration_s: number }> = [
  {
    kind: 'rain',
    label: 'Rain',
    effect: 'every walking spectator slows down and the venue takes longer to clear',
    default_duration_s: 45 * 60,
  },
  {
    kind: 'red_flag',
    label: 'Red flag',
    effect: 'the race stops: everyone seated stays seated, and the flag surge arrives later and harder',
    default_duration_s: ASSUMED_RED_FLAG_S,
  },
  {
    kind: 'mass_departure',
    label: 'Mass departure',
    effect: 'everyone currently seated or held leaves at once instead of dispersing',
    default_duration_s: 0,
  },
  {
    kind: 'track_accident',
    label: 'Track accident',
    effect: 'the session is neutralised: most stay seated while a small share give up and start leaving early',
    default_duration_s: 25 * 60,
  },
  {
    kind: 'gate_failure',
    label: 'Gate failure',
    effect: 'one gate stops admitting: arrivals bound for it are held and everyone routes around it',
    default_duration_s: ASSUMED_GATE_FAILURE_S,
  },
  {
    kind: 'inbound_gridlock',
    label: 'Inbound gridlock',
    effect: 'the approach roads jam: everyone not yet on site arrives later than planned',
    default_duration_s: ASSUMED_GRIDLOCK_DELAY_S,
  },
  {
    kind: 'crowd_medical',
    label: 'Crowd medical incident',
    effect: 'one zone is closed around a casualty and every complying spectator routes around it',
    default_duration_s: ASSUMED_MEDICAL_HOLD_S,
  },
  {
    kind: 'home_win_celebration',
    label: 'Home win celebration',
    effect: 'a home victory keeps a large share on site far longer, deepening the track walk and delaying departure',
    default_duration_s: ASSUMED_CELEBRATION_EXTRA_S,
  },
];

function busiestZone(sim: Simulation, kind?: string): string | null {
  const zones = sim.graph.pack.zones ?? {};
  const counts = new Map<string, number>();
  for (const agent of sim.agents) {
    if (agent.arrived || !agent.started) continue;
    for (const zone of [agent.at, agent.destination]) {
      if (kind && zones[zone]?.kind !== kind) continue;
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let most = 0;
  for (const [zone, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > most) { best = zone; most = count; }
  }
  return best;
}

export function applyAnomaly(sim: Simulation, spec: AnomalySpec, nowS: number, id: string): Anomaly {
  const entry = ANOMALY_CATALOGUE.find((item) => item.kind === spec.kind);
  if (!entry) throw new Error(`unknown anomaly ${spec.kind}; expected one of ${ANOMALY_CATALOGUE.map((item) => item.kind).join(', ')}`);
  const durationS = spec.duration_s ?? entry.default_duration_s;
  if (durationS < 0 || !Number.isFinite(durationS)) throw new Error('duration_s must be a non-negative number');

  let affected = 0;
  let zone: string | undefined;
  if (spec.kind === 'track_accident') {
    for (const agent of sim.agents) {
      if (agent.arrived || agent.dwell_until_s <= nowS) continue;
      if (sim.rng.random() < ASSUMED_ACCIDENT_EARLY_LEAVE_SHARE) {
        agent.dwell_until_s = nowS;
        agent.itinerary = agent.itinerary.slice(-1);
      } else {
        agent.dwell_until_s += durationS;
        for (const leg of agent.itinerary) if (leg.until_s != null) leg.until_s += durationS;
      }
      affected += 1;
    }
  } else if (spec.kind === 'gate_failure' || spec.kind === 'crowd_medical') {
    zone = spec.zone ?? busiestZone(sim, spec.kind === 'gate_failure' ? 'gate' : undefined) ?? undefined;
    if (!zone) throw new Error(`${spec.kind} needs a ${spec.kind === 'gate_failure' ? 'gate with people heading for it' : 'zone with people in it'} and none is busy yet`);
    sim.avoid.add(zone);
    for (const agent of sim.agents) {
      if (agent.arrived) continue;
      if (agent.destination === zone || agent.at === zone || agent.itinerary.some((leg) => leg.zone === zone)) {
        if (agent.dwell_until_s > nowS) agent.dwell_until_s += durationS;
        else if (!agent.started) agent.depart_at_s += durationS;
        affected += 1;
      }
      agent.path = [];
    }
  } else if (spec.kind === 'inbound_gridlock') {
    for (const agent of sim.agents) {
      if (agent.arrived || agent.started) continue;
      agent.depart_at_s += durationS * (0.5 + sim.rng.random());
      affected += 1;
    }
  } else if (spec.kind === 'home_win_celebration') {
    for (const agent of sim.agents) {
      if (agent.arrived) continue;
      if (sim.rng.random() >= ASSUMED_CELEBRATION_EXTRA_SHARE) continue;
      if (agent.dwell_until_s > nowS) agent.dwell_until_s += durationS;
      for (const leg of agent.itinerary) if (leg.until_s != null) leg.until_s += durationS;
      if (agent.pending_leg?.until_s != null) agent.pending_leg.until_s += durationS;
      affected += 1;
    }
  } else if (spec.kind === 'rain') {
    for (const agent of sim.agents) {
      if (agent.arrived) continue;
      agent.desired_speed_ms = Math.max(0.3, agent.desired_speed_ms * ASSUMED_RAIN_SPEED_FACTOR);
      affected += 1;
    }
  } else if (spec.kind === 'red_flag') {
    for (const agent of sim.agents) {
      if (agent.arrived || agent.dwell_until_s <= nowS) continue;
      agent.dwell_until_s += durationS;
      affected += 1;
    }
    for (const agent of sim.agents) {
      for (const leg of agent.itinerary) if (leg.until_s != null) leg.until_s += durationS;
      if (agent.pending_leg?.until_s != null) agent.pending_leg.until_s += durationS;
    }
  } else {
    for (const agent of sim.agents) {
      if (agent.arrived || agent.dwell_until_s <= nowS) continue;
      agent.dwell_until_s = nowS;
      affected += 1;
    }
    for (const agent of sim.agents) {
      for (const leg of agent.itinerary) if (leg.until_s != null) leg.until_s = Math.min(leg.until_s, nowS);
      if (agent.pending_leg?.until_s != null) agent.pending_leg.until_s = Math.min(agent.pending_leg.until_s, nowS);
    }
  }

  return {
    id,
    kind: spec.kind,
    label: entry.label,
    injected_at_s: nowS,
    duration_s: durationS,
    affected_agents: affected,
    effect: entry.effect,
    ...(zone ? { zone } : {}),
  };
}

export function clearAnomaly(sim: Simulation, anomaly: Anomaly): void {
  if (anomaly.zone) sim.avoid.delete(anomaly.zone);
}
