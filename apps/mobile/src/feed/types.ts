/**
 * The spectator feed — everything the phone is allowed to know, and nothing else.
 *
 * WHY THIS FILE EXISTS AT ALL. The obvious design is to ship `VenueState` to the
 * phone and let the app decide what to say. That is wrong three times over:
 *
 *   1. `ZoneState` carries `density_persons_m2`, `estimated_population` and a
 *      Fruin grade. None of that may appear on a spectator screen, and a field
 *      that exists on the client is a field somebody eventually renders.
 *   2. The phone has no venue graph, so it cannot honestly compute a walking
 *      time. Anything it derived would be a guess wearing a number's clothes.
 *   3. Under D7 the uplink is opportunistic. Sending three zones' worth of words
 *      instead of the whole venue state is the difference between a route update
 *      that fits in a mesh message and one that does not.
 *
 * So the engine does the arithmetic and the classification, and the phone
 * receives the *conclusion*: a place name, a number of seconds, and a band.
 * There is not one threshold in this app, because there is nothing left here to
 * threshold. Any constant that would classify the world is a defect in this
 * directory — it belongs in packages/contracts/standards.py.
 *
 * Types imported from @contracts are generated from the Pydantic source of truth
 * (packages/contracts). If the engine changes shape, this file stops compiling,
 * which is the entire point of keeping the app in the monorepo.
 */

import type { LOSBand, RerouteCommand, SafetyVerdict } from '@contracts';

/**
 * How the next stretch of walking will feel.
 *
 * The three LOS bands pass through unchanged — the engine already classified
 * them on density (standards.band_for_density), and re-deriving a band on the
 * client from anything else, flow especially, is the classic mistake this
 * codebase is built to avoid.
 *
 * `unknown` is the fourth case and it is not a failure: a zone with no reporting
 * device is unobserved, never empty. The app says so rather than drawing a calm
 * green stretch over a corridor nobody has looked at.
 */
export type WayAhead = LOSBand | 'unknown';

/** One leg of the walk: a place you can see, and how the walk to it will feel. */
export interface Step {
  id: string;
  /** Zone.name from the venue pack — a landmark a distracted person can find. */
  to: string;
  /** Walking seconds for this leg, from the routing engine. Never derived here. */
  walk_s: number;
  way_ahead: WayAhead;
  /** Set when this leg passes a bridge, tunnel or track crossing. */
  crossing: CrossingNotice | null;
}

/**
 * A crossing's timetable.
 *
 * This earns its place on a spectator screen because it is the one thing a
 * spectator genuinely cannot see for themselves: the bridge ahead may be about
 * to close for a support race, and no amount of looking at it will tell you.
 *
 * Times are absolute unix seconds so the phone can count down through an offline
 * period without a fresh message. `null` means the engine does not know when —
 * which is stated as not knowing, never as "soon".
 */
export interface CrossingNotice {
  name: string;
  state:
    | { open: true; closes_at: number | null }
    | { open: false; opens_at: number | null };
}

/** Where you are, where you are going, and the walk between them. */
export interface Route {
  id: string;
  /** Where you are now. Always on screen — orientation before instruction. */
  from: string;
  /** Where you are going. */
  to: string;
  steps: Step[];
  /**
   * Door-to-door seconds from the routing engine.
   *
   * Not the sum of the steps: the engine knows about waits at a closed crossing
   * and about the slower walking speed of a busy corridor, and the phone does
   * not. Summing here would quietly understate the journey.
   */
  total_walk_s: number;
}

/**
 * An alternative the system would like to offer, with its price attached.
 *
 * The command and the verdict travel together on purpose. Invariant 4: the agent
 * recommends, it never acts — and the last mile of that rule is the client, which
 * must refuse to render an offer the safety engine did not approve. See
 * `showableOffer` in ./offer.ts.
 */
export interface RerouteOffer {
  command: RerouteCommand;
  verdict: SafetyVerdict;
  /** The route you would walk instead, so the cost is visible and not just stated. */
  instead: Route;
}

/**
 * Whether we are hearing from the world, and how recently.
 *
 * Shown honestly rather than hidden: a spectator acting on ten-minute-old advice
 * in a moving crowd is worse off than one who knows the advice is ten minutes old.
 */
export interface LinkStatus {
  /** True when this phone (or a peer) currently has an uplink off the venue. */
  online: boolean;
  /** Nearby phones carrying our traffic. Only ever shown on the offline screen. */
  mesh_peers: number;
  /** Unix seconds of the newest observation behind this route. */
  updated_at: number;
}

/** A gate you could walk in through, and what it costs you. */
export interface GateChoice {
  zone_id: string;
  name: string;
  walk_s: number;
  way_ahead: WayAhead;
  /** One short clause of why, in the user's terms. Optional; silence beats filler. */
  note?: string;
}

/** A way out after the race, priced honestly, including standing still. */
export interface LeaveOption {
  id: string;
  /** The action, phrased as the user would say it: "Wait here", "Walk to Gate 6". */
  label: string;
  /**
   * Seconds this option costs door-to-car. For "wait", it includes the waiting.
   * Comparable across options, which is the only way the numbers mean anything.
   */
  total_s: number;
  way_ahead: WayAhead;
  /** What you would actually be doing. "Standing in a queue", "Walking". */
  spent: string;
}

interface ViewBase {
  now: number;
  link: LinkStatus;
  route: Route;
}

/**
 * The six states of a race day. A discriminated union so that adding a state
 * breaks every switch that has not handled it — including the renderer.
 */
export type SpectatorView =
  | (ViewBase & {
      kind: 'arrival';
      /**
       * The cheapest intervention of the day: it costs the spectator nothing and
       * flattens the arrival peak for everyone. Offered before they have started
       * walking, because afterwards it is a reroute and it costs minutes.
       */
      gates: GateChoice[];
      /**
       * One sentence of orientation, from the engine.
       *
       * It names a specific gate, so it cannot live in the component: a screen
       * with "Gate 3" typed into it is a screen that lies at every other circuit
       * and at this one tomorrow.
       */
      note: string;
    })
  | (ViewBase & { kind: 'walk' })
  | (ViewBase & {
      kind: 'ahead';
      /** The step the system is worried about. Still walkable, right now. */
      step_id: string;
      offer: RerouteOffer;
    })
  | (ViewBase & {
      kind: 'rerouted';
      /** Kept and shown struck through: a change you cannot see is a change you distrust. */
      instead_of: Route;
      added_s: number;
      reason: string;
    })
  | (ViewBase & { kind: 'offline' })
  | (ViewBase & {
      kind: 'hold';
      /**
       * Ordered best-first by the engine. The first option may be "wait", and an
       * app that cannot say wait just moves the crowd into one corridor at once.
       */
      options: LeaveOption[];
      recommended_id: string;
      /** The advice in four words. Distinct from the option's own label. */
      headline: string;
      /**
       * Why, in facts the user can check by looking around or by reading the
       * crossing row below. Being told to wait without a reason is being managed;
       * being told the steps are full and the crossing is shut is being informed.
       */
      because: string;
    });

export type ViewKind = SpectatorView['kind'];
