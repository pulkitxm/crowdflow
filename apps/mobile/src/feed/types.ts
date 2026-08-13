/**
 * The spectator feed is authored in the contracts workspace, not in this app.
 *
 * The phone receives conclusions — landmarks, walking seconds, the density band
 * already selected by the state engine, crossing times and a safety-reviewed
 * offer — rather than `VenueState`.  Keeping the complete feed in
 * `packages/contracts` means a producer and this renderer cannot drift while
 * still compiling.  There are deliberately no local shadow interfaces here.
 */

export type {
  CrossingNotice,
  GateChoice,
  LeaveOption,
  LinkStatus,
  RerouteOffer,
  Route,
  SpectatorView,
  Step,
  WayAhead,
} from '@crowdflow/contracts';

import type { SpectatorView } from '@crowdflow/contracts';

/** The six states of a race day, derived from the authored discriminated union. */
export type ViewKind = SpectatorView['kind'];
