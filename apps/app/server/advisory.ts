import { randomUUID } from 'node:crypto';
import type { Forecast, VenueState } from '@crowdflow/contracts';
import type { InsightEngine } from '@crowdflow/agent';
import type { AgentAdvisory, SpectatorNotice } from '@crowdflow/contracts/wire';

export const ADVISORY_INTERVAL_S = 120;
export const ADVISORY_KEEP = 12;

export class AdvisoryDesk {
  private readonly open: AgentAdvisory[] = [];
  private readonly published: SpectatorNotice[] = [];
  private lastSweepS = -Infinity;

  advisories(): AgentAdvisory[] { return this.open; }
  notices(nowS: number): SpectatorNotice[] { return this.published.filter((notice) => nowS < notice.expires_at_s); }

  sweep(nowS: number, state: VenueState, forecasts: Forecast[], insights: InsightEngine | null, zoneName: (id: string) => string): AgentAdvisory[] {
    if (nowS - this.lastSweepS < ADVISORY_INTERVAL_S) return this.open;
    this.lastSweepS = nowS;

    const fresh: AgentAdvisory[] = [];
    const zones = Object.values(state.zones ?? {});

    for (const forecast of forecasts.filter((item) => item.actionable).slice(0, 2)) {
      fresh.push({
        id: `adv-${randomUUID().slice(0, 8)}`,
        kind: 'forecast',
        severity: forecast.target_band === 'critical' ? 'critical' : 'warning',
        headline: `${zoneName(forecast.zone_id)} is projected to reach ${forecast.target_band.toUpperCase()}${forecast.time_to_threshold_s == null ? '' : ` in ${Math.round(forecast.time_to_threshold_s)}s`}`,
        detail: (forecast.causes ?? []).join('; ') || 'trend extrapolated from the last observations',
        zone_id: forecast.zone_id,
        crowd_message: `Heavy crowding expected near ${zoneName(forecast.zone_id)}. Allow extra time or use an alternative route.`,
        model_id: forecast.model_id,
        raised_at_s: nowS,
        approved: false,
      });
    }

    const overCapacity = zones.filter((zone) => zone.over_capacity).sort((a, b) => b.density_persons_m2 - a.density_persons_m2)[0];
    if (overCapacity) {
      fresh.push({
        id: `adv-${randomUUID().slice(0, 8)}`,
        kind: 'over_capacity',
        severity: 'critical',
        headline: `${zoneName(overCapacity.zone_id)} is over capacity at ${overCapacity.density_persons_m2.toFixed(2)} ped/m²`,
        detail: `flow ${overCapacity.flow_ped_m_min.toFixed(1)} ped/m/min, LOS ${overCapacity.los_grade}, ${overCapacity.observed_nodes} devices observed`,
        zone_id: overCapacity.zone_id,
        crowd_message: `${zoneName(overCapacity.zone_id)} is very busy. Please follow steward directions and consider waiting before moving.`,
        model_id: 'state-engine',
        raised_at_s: nowS,
        approved: false,
      });
    }

    for (const insight of (insights?.insights(2) ?? [])) {
      fresh.push({
        id: `adv-${randomUUID().slice(0, 8)}`,
        kind: 'insight',
        severity: 'info',
        headline: insight.headline,
        detail: `${insight.metric} · ${insight.samples} samples · deviation ${insight.deviation.toFixed(1)}`,
        zone_id: insight.subject,
        crowd_message: `Conditions around ${insight.subject_name} are unusual today. Check the app before you set off.`,
        model_id: 'insight-engine',
        raised_at_s: nowS,
        approved: false,
      });
    }

    for (const advisory of fresh) {
      if (this.open.some((existing) => existing.kind === advisory.kind && existing.zone_id === advisory.zone_id && !existing.approved)) continue;
      this.open.unshift(advisory);
    }
    this.open.length = Math.min(this.open.length, ADVISORY_KEEP);
    return this.open;
  }

  approve(id: string, nowS: number, ttlS: number): SpectatorNotice {
    const advisory = this.open.find((item) => item.id === id);
    if (!advisory) throw new Error(`no advisory ${id}; advisories do not survive a restart`);
    if (advisory.approved) throw new Error(`advisory ${id} is already published to spectators`);
    advisory.approved = true;
    const notice: SpectatorNotice = {
      id: `note-${randomUUID().slice(0, 8)}`,
      advisory_id: advisory.id,
      severity: advisory.severity,
      message: advisory.crowd_message,
      zone_id: advisory.zone_id,
      published_at_s: nowS,
      expires_at_s: nowS + ttlS,
      approved_by: 'operator',
    };
    this.published.unshift(notice);
    return notice;
  }
}
