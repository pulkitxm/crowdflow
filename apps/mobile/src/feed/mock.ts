/**
 * THE MOCK FEED. This is the only file in the app that invents data.
 *
 * WHERE THE REAL FEED ATTACHES: replace `buildDay` with a subscription that
 * decodes `MeshMessage` payloads of type `route_update`, `alert` and `reroute`
 * into `SpectatorView`. Nothing else in `src/` changes — every screen is a pure
 * function of a `SpectatorView`, and no component reaches past the view it was
 * handed. If a real feed ever needs a field that is not in `./types.ts`, that is
 * a conversation about the contract, not a client-side addition.
 *
 * Place names are real Silverstone zones from circuits/silverstone/pack: the
 * stands (Copse B, Farm Curve), the gates (3, 4, 6) and North Car Park 22. Made
 * up landmarks would hide the fact that this venue's names are what the user
 * actually has to navigate by.
 *
 * The day it tells is one story in six states, and the story has a point: the
 * gate choice at 11:00 costs the spectator nothing and is the cheapest thing the
 * system will do all day; by 13:40 the same amount of relief costs them four
 * minutes of walking; by 16:30 the only honest advice is to sit still.
 *
 * Times are absolute unix seconds anchored to app start, so countdowns really
 * count down while the demo is open — including on the offline screen, which is
 * the point of putting absolute times on the wire rather than "closes in 8 min".
 */

import type { RerouteCommand, SafetyVerdict } from '@crowdflow/contracts';

import type { LinkStatus, Route, SpectatorView, ViewKind } from './types';

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const MIN = 60;

/** A device with an uplink and fresh data — the ordinary case. */
function connected(now: number): LinkStatus {
  return { online: true, mesh_peers: 12, updated_at: now - 8 };
}

export function buildDay(now: number): Record<ViewKind, SpectatorView> {
  // --- the walk in, once a gate has been chosen ---------------------------
  const viaBridge: Route = {
    id: 'route-bridge',
    from: 'Gate 3',
    to: 'Copse B',
    total_walk_s: 10 * MIN,
    steps: [
      { id: 's1', to: 'Village concourse', walk_s: 210, way_ahead: 'nominal', crossing: null },
      {
        id: 's2',
        to: 'Bridge at Village',
        walk_s: 150,
        way_ahead: 'nominal',
        crossing: { name: 'Bridge at Village', state: { open: true, closes_at: now + 25 * MIN } },
      },
      { id: 's3', to: 'Copse B', walk_s: 190, way_ahead: 'nominal', crossing: null },
    ],
  };

  // --- halfway there, the bridge starts to fill --------------------------
  const remainingViaBridge: Route = {
    id: 'route-bridge-remaining',
    from: 'Village concourse',
    to: 'Copse B',
    total_walk_s: 6 * MIN,
    steps: [
      {
        id: 's2',
        to: 'Bridge at Village',
        walk_s: 120,
        // STILL WALKABLE. The app is speaking because the model says it will not
        // be shortly, not because the user cannot get across right now.
        way_ahead: 'building',
        crossing: { name: 'Bridge at Village', state: { open: true, closes_at: now + 22 * MIN } },
      },
      { id: 's3', to: 'Copse B', walk_s: 190, way_ahead: 'nominal', crossing: null },
    ],
  };

  const viaUnderpass: Route = {
    id: 'route-underpass',
    from: 'Village concourse',
    to: 'Copse B',
    total_walk_s: 10 * MIN,
    steps: [
      {
        id: 'u1',
        to: 'Farm Curve underpass',
        walk_s: 260,
        way_ahead: 'nominal',
        crossing: { name: 'Farm Curve underpass', state: { open: true, closes_at: null } },
      },
      { id: 'u2', to: 'Copse B', walk_s: 250, way_ahead: 'nominal', crossing: null },
    ],
  };

  /**
   * The command as it would arrive over the mesh. `expected_cost_s` is exactly
   * the difference between the two routes above — if those ever disagree the app
   * is lying to the user about the price, which `mock.test.ts` checks.
   */
  const rerouteCommand: RerouteCommand = {
    command_id: 'cmd-village-bridge-1',
    issued_at: now - 20,
    expires_at: now + 8 * MIN,
    source_zone: 'concourse_village',
    destination_zone: 'stand_227342441',
    avoid: ['crossing_village_bridge'],
    prefer: ['crossing_farm_underpass'],
    target_fraction: 0.35,
    reason: 'The bridge at Village is filling up. The underpass by Farm Curve is quieter.',
    expected_cost_s: 4 * MIN,
  };

  const approved: SafetyVerdict = {
    command_id: rerouteCommand.command_id,
    outcome: 'approved',
    reason: 'Alternative keeps both routes below capacity and clears the emergency lane.',
    violated_constraints: [],
    emergency_mode: false,
    dispatchable: true,
  };

  // --- the walk out ------------------------------------------------------
  const wayOut: Route = {
    id: 'route-egress',
    from: 'Copse B',
    to: 'North Car Park 22',
    total_walk_s: 31 * MIN,
    steps: [
      { id: 'e1', to: 'Vale steps', walk_s: 180, way_ahead: 'critical', crossing: null },
      {
        id: 'e2',
        to: 'Gate 4',
        walk_s: 300,
        way_ahead: 'critical',
        // Post-race the track itself becomes a crossing. A spectator cannot see
        // when the marshals open it, which is precisely why it is worth screen space.
        crossing: {
          name: 'Track crossing at Vale',
          state: { open: false, opens_at: now + 10 * MIN },
        },
      },
      { id: 'e3', to: 'North Car Park 22', walk_s: 420, way_ahead: 'nominal', crossing: null },
    ],
  };

  return {
    arrival: {
      kind: 'arrival',
      now,
      link: connected(now),
      route: {
        id: 'route-arrival',
        from: 'North Car Park 22',
        to: 'Copse B',
        total_walk_s: 16 * MIN,
        steps: [
          { id: 'a1', to: 'Gate 3', walk_s: 11 * MIN, way_ahead: 'nominal', crossing: null },
          { id: 'a2', to: 'Copse B', walk_s: 300, way_ahead: 'nominal', crossing: null },
        ],
      },
      note: 'Your ticket works at any gate. Gate 3 is a few minutes further and you walk straight in.',
      // The nearest gate is the busiest one: that is why this screen exists.
      gates: [
        {
          zone_id: 'gate_3649603665',
          name: 'Gate 4',
          walk_s: 7 * MIN,
          way_ahead: 'critical',
          note: 'Nearest, and everyone else has had the same idea',
        },
        {
          zone_id: 'gate_4293569494',
          name: 'Gate 3',
          walk_s: 11 * MIN,
          way_ahead: 'nominal',
          note: 'Four minutes further, no queue',
          selected: true,
        },
        {
          zone_id: 'gate_5747045954',
          name: 'Gate 6',
          walk_s: 16 * MIN,
          way_ahead: 'nominal',
        },
      ],
    },

    walk: { kind: 'walk', now, link: connected(now), route: viaBridge },

    ahead: {
      kind: 'ahead',
      now,
      link: connected(now),
      route: remainingViaBridge,
      step_id: 's2',
      offer: { command: rerouteCommand, verdict: approved, instead: viaUnderpass },
    },

    rerouted: {
      kind: 'rerouted',
      now,
      link: connected(now),
      route: viaUnderpass,
      instead_of: remainingViaBridge,
      added_s: rerouteCommand.expected_cost_s,
      reason: rerouteCommand.reason,
    },

    offline: {
      kind: 'offline',
      now,
      // No uplink, but 34 phones in earshot are still passing state around. This
      // is the one screen where the mesh is worth explaining: here it is the
      // reason the screen still works, not a technical detail.
      link: { online: false, mesh_peers: 34, updated_at: now - 3 * MIN - 20 },
      route: {
        id: 'route-offline',
        from: 'Farm Curve underpass',
        to: 'Copse B',
        total_walk_s: 7 * MIN,
        steps: [
          {
            id: 'o1',
            to: 'Club corner path',
            walk_s: 180,
            // Invariant 5: nobody is reporting from here. Not "clear". Not empty.
            way_ahead: 'unknown',
            crossing: {
              name: 'Club crossing',
              state: { open: false, opens_at: now + 8 * MIN },
            },
          },
          { id: 'o2', to: 'Copse B', walk_s: 220, way_ahead: 'nominal', crossing: null },
        ],
      },
    },

    hold: {
      kind: 'hold',
      now,
      link: connected(now),
      route: wayOut,
      recommended_id: 'wait',
      headline: 'Wait here for now.',
      because:
        'The steps down to Gate 4 are full, and the track crossing is not open yet. You get to the car sooner by letting it clear.',
      options: [
        {
          id: 'wait',
          label: 'Stay where you are',
          total_s: 22 * MIN,
          way_ahead: 'nominal',
          spent: 'Sitting for about 12 minutes, then a 10 minute walk',
          recommendation_note: 'Quickest, with time to sit down',
        },
        {
          id: 'gate-6',
          label: 'Walk out by Gate 6',
          total_s: 24 * MIN,
          way_ahead: 'nominal',
          spent: 'Walking the whole way',
        },
        {
          id: 'now',
          label: 'Leave now by Gate 4',
          total_s: 31 * MIN,
          way_ahead: 'critical',
          spent: 'Most of it standing still on the steps',
        },
      ],
    },
  };
}

/**
 * Built once, at app start, so that every countdown on every screen shares one
 * clock. The real feed replaces this constant with a subscription.
 */
export const DAY = buildDay(nowSeconds());

/** Ordered as the day happens, for the demo switcher. */
export const DAY_ORDER: ViewKind[] = ['arrival', 'walk', 'ahead', 'rerouted', 'offline', 'hold'];

/** What the switcher calls each state. Demo scaffolding — never shown in-app. */
export const DAY_LABELS: Record<ViewKind, { title: string; when: string }> = {
  arrival: { title: 'Arriving', when: '11:02' },
  walk: { title: 'On the way in', when: '11:20' },
  ahead: { title: 'Crowd building ahead', when: '13:38' },
  rerouted: { title: 'Redirected', when: '13:39' },
  offline: { title: 'No signal', when: '14:05' },
  hold: { title: 'After the race', when: '16:31' },
};
