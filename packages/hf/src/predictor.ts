import type { Forecast, LOSBand, VenueState, ZoneState } from '@crowdflow/contracts';
import { DENSITY_BUILDING_MAX, DENSITY_NOMINAL_MAX, isActionable } from '@crowdflow/contracts';
import { InferenceClient } from '@huggingface/inference';
import { clamp01, round } from '@crowdflow/core/statistics';
import { toTabularData, zoneFeatureRow } from './features.js';

export interface HfProbabilityModel {
  readonly model_id: string;
  infer(data: Record<string, string[]>): Promise<number[]>;
}

/** A tabular-regression model served through the Hugging Face Inference API. */
export class TabularInferenceModel implements HfProbabilityModel {
  readonly model_id: string;
  constructor(readonly model: string, private readonly client: InferenceClient) { this.model_id = `hf:${model}`; }
  infer(data: Record<string, string[]>): Promise<number[]> {
    return this.client.tabularRegression({ model: this.model, inputs: { data } });
  }
}

export interface CreateHfPredictorOptions { model: string; token?: string | undefined; endpointUrl?: string | undefined; horizonS?: number | undefined }

/** Build a real `HfPredictor` against the Inference API. */
export function createHfPredictor(options: CreateHfPredictorOptions): HfPredictor {
  const client = new InferenceClient(options.token, options.endpointUrl ? { endpointUrl: options.endpointUrl } : undefined);
  return new HfPredictor(new TabularInferenceModel(options.model, client), { horizonS: options.horizonS });
}

export class HfPredictor {
  readonly model_id: string;
  readonly horizonS: number;
  constructor(readonly model: HfProbabilityModel, readonly options: { horizonS?: number | undefined } = {}) {
    this.model_id = model.model_id;
    this.horizonS = options.horizonS ?? 300;
  }

  /**
   * Forecasts every observed zone through the hosted model in one batch.
   * The model predicts `time_to_threshold_s` (seconds until the zone crosses
   * its next band); the remaining `Forecast` fields are composed
   * deterministically from the current zone state. A model output of at least
   * `horizonS` seconds means "no crossing within horizon".
   */
  async forecast(state: VenueState): Promise<Forecast[]> {
    const zones = Object.values(state.zones ?? {});
    if (!zones.length) return [];
    const data = toTabularData(zones.map((zone) => ({ zone_id: zone.zone_id, features: zoneFeatureRow(zone) })));
    const outputs = await this.model.infer(data);
    return zones.map((zone, index) => composeForecast(zone, outputs[index] ?? this.horizonS, this.model_id, this.horizonS))
      .sort((a, b) => (a.time_to_threshold_s ?? Infinity) - (b.time_to_threshold_s ?? Infinity));
  }
}

export function composeForecast(zone: ZoneState, timeToThreshold: number, modelId: string, horizonS: number): Forecast {
  const current = zone.density_persons_m2;
  const targetBand: LOSBand = current >= DENSITY_NOMINAL_MAX ? 'critical' : 'building';
  const threshold = targetBand === 'critical' ? DENSITY_BUILDING_MAX : DENSITY_NOMINAL_MAX;
  const crossing = timeToThreshold >= 0 && timeToThreshold < horizonS;
  const probability = crossing ? clamp01(1 - (timeToThreshold / horizonS) * 0.7) : 0.05;
  const forecast: Forecast = {
    zone_id: zone.zone_id,
    issued_at: zone.timestamp,
    horizon_s: horizonS,
    target_band: targetBand,
    probability: round(probability, 3),
    time_to_threshold_s: crossing ? round(timeToThreshold, 1) : null,
    projected_peak_density_persons_m2: round(Math.max(current, threshold), 2),
    confidence: zone.confidence.value,
    model_id: modelId,
    actionable: false,
  };
  return { ...forecast, actionable: isActionable(forecast) };
}
