/**
 * The sensing stack, as one React hook.
 *
 * Exists so that `App.tsx` contains no sensing logic at all. The engine has a
 * lifecycle that does not match a component's — it holds native subscriptions, a
 * timer, a rotating identifier and an upload queue — and the two failure modes
 * of mixing those with React are both bad in the same direction: an engine
 * rebuilt on every render restarts the radios and loses the queue, and an engine
 * that outlives its component keeps scanning after somebody has withdrawn
 * consent.
 *
 * So the engine is created once per (circuit, mode) pair and torn down when that
 * changes or the component unmounts. `enabled` starts and stops it without
 * rebuilding, because pausing sharing must not lose the anchor map it just
 * downloaded over a saturated cell network.
 */

import { useEffect, useMemo, useState } from 'react';
import type { AnchorPack, CircuitPack, SensingStatus } from '@crowdflow/contracts';

import type { CircuitSource } from '../circuits/registry';
import { SensingEngine } from './engine';

export interface UseSensingOptions {
  /** Where reports go. Empty for a build with no venue: samples queue and the
   *  status screen says so rather than logging a network error every batch. */
  baseUrl: string;
  source: CircuitSource;
  circuitId: string | null;
  /** Consent granted AND sharing switched on. Either one false stops sensing. */
  enabled: boolean;
  /** `rehearsal` swaps the three radios for the simulator and changes nothing
   *  else — same solve, same ladder, same uplink, same server. */
  mode?: 'device' | 'rehearsal';
}

export interface Sensing {
  status: SensingStatus | null;
  /** Seconds until the reporting pseudonym rotates. Refreshed on each status. */
  pseudonymExpiresIn: number;
  survey: { anchors: number; wifi: number; ble: number; surveyedAt: string | null };
  /** Why the stack could not be built at all, as one sentence. */
  problem: string | null;
}

const NO_SURVEY = { anchors: 0, wifi: 0, ble: 0, surveyedAt: null as string | null };

export function useSensing(options: UseSensingOptions): Sensing {
  const { baseUrl, source, circuitId, enabled, mode = 'device' } = options;
  const [status, setStatus] = useState<SensingStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(0);
  const [survey, setSurvey] = useState(NO_SURVEY);

  // The pack and the anchor map, fetched once per circuit. Deliberately not
  // refetched when `enabled` flips: a person toggling sharing off and on again
  // should not re-download a survey over a cell network that is the reason the
  // mesh exists.
  const [loaded, setLoaded] = useState<{ pack: CircuitPack; anchors: AnchorPack } | null>(null);

  useEffect(() => {
    if (!circuitId) { setLoaded(null); return; }
    let live = true;
    (async () => {
      try {
        const [geometry, anchors] = await Promise.all([source.geometry(circuitId), source.anchors(circuitId)]);
        if (live) { setLoaded({ pack: geometry.pack, anchors }); setProblem(null); }
      } catch (error) {
        if (live) {
          setLoaded(null);
          setProblem(error instanceof Error ? error.message : 'the circuit could not be loaded');
        }
      }
    })();
    return () => { live = false; };
  }, [source, circuitId]);

  const engine = useMemo(() => {
    if (!loaded) return null;
    return new SensingEngine({ baseUrl, pack: loaded.pack, anchors: loaded.anchors, mode });
  }, [baseUrl, loaded, mode]);

  useEffect(() => {
    if (!engine) { setStatus(null); setSurvey(NO_SURVEY); return; }
    setSurvey(engine.survey);
    const unsubscribe = engine.subscribe((next) => {
      setStatus(next);
      setExpiresIn(engine.pseudonymExpiresIn());
    });
    // Stop on unmount unconditionally. An engine that survives its component is
    // an engine still scanning after consent was withdrawn.
    return () => { unsubscribe(); void engine.stop(); };
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    if (enabled) void engine.start();
    else void engine.stop();
  }, [enabled, engine]);

  return { status, pseudonymExpiresIn: expiresIn, survey, problem };
}
