import { describe, expect, it } from 'vitest';

import { DAY_ORDER, buildDay } from './mock';
import { showableOffer } from './offer';
import type { Route, SpectatorView, ViewKind } from './types';

const NOW = 1_700_000_000;
const day = buildDay(NOW);

function routesOf(view: SpectatorView): Route[] {
  const routes = [view.route];
  if (view.kind === 'ahead') routes.push(view.offer.instead);
  if (view.kind === 'rerouted') routes.push(view.instead_of);
  return routes;
}

describe('the day is complete', () => {
  it('has a screen for every state the switcher offers', () => {
    expect(new Set(DAY_ORDER)).toEqual(new Set(Object.keys(day) as ViewKind[]));
    expect(DAY_ORDER).toHaveLength(6);
  });

  it('always knows where you are and where you are going', () => {
    for (const view of Object.values(day)) {
      for (const route of routesOf(view)) {
        expect(route.from.length).toBeGreaterThan(0);
        expect(route.to.length).toBeGreaterThan(0);
        expect(route.steps.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('journey totals are honest', () => {
  it('never claims a journey is shorter than the sum of its legs', () => {
    // The engine's total includes waits at crossings and slower walking in a busy
    // corridor, so it may exceed the legs. A total BELOW the legs would mean the
    // screen is quoting a walk nobody can achieve.
    for (const view of Object.values(day)) {
      for (const route of routesOf(view)) {
        const legs = route.steps.reduce((sum, step) => sum + step.walk_s, 0);
        expect(route.total_walk_s).toBeGreaterThanOrEqual(legs);
      }
    }
  });
});

describe('the price of a redirect matches the walk it buys', () => {
  it('states a cost equal to the difference between the two routes', () => {
    const ahead = day.ahead;
    if (ahead.kind !== 'ahead') throw new Error('expected the ahead view');
    const showable = showableOffer(ahead.offer);
    expect(showable).not.toBeNull();
    // If these ever disagree, the button says "+4 min" while the route it leads
    // to costs six — the single most damaging thing this screen could do.
    expect(showable!.cost_s).toBe(ahead.offer.instead.total_walk_s - ahead.route.total_walk_s);
  });

  it('carries the same cost through to the redirected screen', () => {
    const ahead = day.ahead;
    const rerouted = day.rerouted;
    if (ahead.kind !== 'ahead' || rerouted.kind !== 'rerouted') throw new Error('bad fixture');
    expect(rerouted.added_s).toBe(ahead.offer.command.expected_cost_s);
    expect(rerouted.route.id).toBe(ahead.offer.instead.id);
    // The abandoned route is kept so the change stays legible on screen.
    expect(rerouted.instead_of.id).toBe(ahead.route.id);
  });
});

describe('the warning fires while the way is still walkable', () => {
  it('warns on a slowing crossing, not a blocked one', () => {
    const ahead = day.ahead;
    if (ahead.kind !== 'ahead') throw new Error('expected the ahead view');
    const step = ahead.route.steps.find((s) => s.id === ahead.step_id);
    expect(step).toBeDefined();
    // Critical here would mean the app spoke too late; nominal would mean it had
    // nothing to say. The product lives entirely in the middle band.
    expect(step!.way_ahead).toBe('building');
    expect(step!.crossing?.state.open).toBe(true);
  });
});

describe('offline is a working state, not an error state', () => {
  it('keeps routing with no uplink and says so', () => {
    const offline = day.offline;
    if (offline.kind !== 'offline') throw new Error('expected the offline view');
    expect(offline.link.online).toBe(false);
    expect(offline.link.mesh_peers).toBeGreaterThan(0);
    expect(offline.link.updated_at).toBeLessThan(NOW);
  });

  it('renders an unobserved stretch as unknown rather than as clear', () => {
    const offline = day.offline;
    if (offline.kind !== 'offline') throw new Error('expected the offline view');
    expect(offline.route.steps.some((s) => s.way_ahead === 'unknown')).toBe(true);
  });

  it('carries absolute crossing times so a countdown survives the outage', () => {
    const offline = day.offline;
    if (offline.kind !== 'offline') throw new Error('expected the offline view');
    const crossing = offline.route.steps.find((s) => s.crossing)?.crossing;
    expect(crossing).toBeDefined();
    expect(crossing!.state.open).toBe(false);
    expect(crossing!.state.open === false && crossing!.state.opens_at).toBeGreaterThan(NOW);
  });
});

describe('after the race the app is willing to say wait', () => {
  it('recommends the option that actually gets you to the car soonest', () => {
    const hold = day.hold;
    if (hold.kind !== 'hold') throw new Error('expected the hold view');
    const best = [...hold.options].sort((a, b) => a.total_s - b.total_s)[0]!;
    // Waiting is only defensible if the arithmetic supports it. If leaving now
    // were quicker this screen would have to say so.
    expect(hold.recommended_id).toBe(best.id);
    expect(hold.recommended_id).toBe('wait');
  });

  it('still offers a way out to someone who will not wait', () => {
    const hold = day.hold;
    if (hold.kind !== 'hold') throw new Error('expected the hold view');
    expect(hold.options.length).toBeGreaterThanOrEqual(3);
    expect(hold.options.some((o) => o.id !== hold.recommended_id)).toBe(true);
  });

  it('prices every option the same way so they can be compared', () => {
    const hold = day.hold;
    if (hold.kind !== 'hold') throw new Error('expected the hold view');
    for (const option of hold.options) {
      expect(option.total_s).toBeGreaterThan(0);
      expect(option.spent.length).toBeGreaterThan(0);
    }
  });

  it('gives a reason the user can check by looking around', () => {
    const hold = day.hold;
    if (hold.kind !== 'hold') throw new Error('expected the hold view');
    expect(hold.because.length).toBeGreaterThan(0);
    // The advice must not simply repeat the option's label back at the user.
    expect(hold.headline).not.toBe(hold.options.find((o) => o.id === hold.recommended_id)?.label);
  });
});

describe('the gate choice is a real choice', () => {
  it('is honest that the nearest gate is the busy one', () => {
    const arrival = day.arrival;
    if (arrival.kind !== 'arrival') throw new Error('expected the arrival view');
    const nearest = [...arrival.gates].sort((a, b) => a.walk_s - b.walk_s)[0]!;
    expect(nearest.way_ahead).not.toBe('nominal');
    // ...and there is somewhere clear to send people, or the screen is just bad news.
    expect(arrival.gates.some((g) => g.way_ahead === 'nominal')).toBe(true);
  });
});
