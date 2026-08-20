
import { useEffect, useMemo, useState } from 'react';
import type { AnchorPack, CircuitPack, SensingStatus } from '@crowdflow/contracts';

import type { CircuitSource } from '../circuits/registry';
import { SensingEngine } from './engine';

export interface UseSensingOptions {
  baseUrl: string;
  source: CircuitSource;
  circuitId: string | null;
  enabled: boolean;
  mode?: 'device' | 'rehearsal';
}

export interface Sensing {
  status: SensingStatus | null;
  pseudonymExpiresIn: number;
  survey: { anchors: number; wifi: number; ble: number; surveyedAt: string | null };
  problem: string | null;
}

const NO_SURVEY = { anchors: 0, wifi: 0, ble: 0, surveyedAt: null as string | null };

export function useSensing(options: UseSensingOptions): Sensing {
  const { baseUrl, source, circuitId, enabled, mode = 'device' } = options;
  const [status, setStatus] = useState<SensingStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(0);
  const [survey, setSurvey] = useState(NO_SURVEY);

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
    return () => { unsubscribe(); void engine.stop(); };
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    if (enabled) void engine.start();
    else void engine.stop();
  }, [enabled, engine]);

  return { status, pseudonymExpiresIn: expiresIn, survey, problem };
}
