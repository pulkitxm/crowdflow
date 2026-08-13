/**
 * The prediction panel.
 *
 * The headline is TIME TO EVENT, in the largest type on the screen. Not the
 * current density, not a percentage: "T-02:47 to CRITICAL at Vale Bridge" is a
 * sentence an operator can act on, and "87% full" is not. The current value is
 * present, in small type, as supporting evidence rather than as the claim.
 *
 * Confidence sits beside the claim, always, and the model that produced it is
 * named. A baseline rule extrapolating a trend and a learned model must never be
 * indistinguishable on a wall — the operator's trust should track which one is
 * actually talking.
 *
 * When nothing is predicted to cross, the panel says exactly that, with the
 * horizon it looked over. A blank prediction panel and a quiet venue look
 * identical, and only one of them is good news.
 */
import type { TickEnvelope } from "@wire";
import { clear, el, stateCell } from "../dom";
import { NO_VALUE, countdown, fixed, percent } from "../format";
import { BAND_WORD } from "../model";
import type { ZoneRow } from "../model";

export class PredictionPanel {
  constructor(
    private readonly host: HTMLElement,
    private readonly meta: HTMLElement,
  ) {}

  update(envelope: TickEnvelope, rows: Map<string, ZoneRow>, name: (id: string) => string): void {
    const forecasts = envelope.forecasts ?? [];
    // Whether a forecast clears the bar is decided by the contract and shipped
    // in the envelope. The console must not own a copy of that comparison.
    const actionableIds = new Set(envelope.actionable ?? []);
    const actionable = forecasts.filter((f) => actionableIds.has(f.zone_id));
    const headline = actionable[0] ?? forecasts.find((f) => f.time_to_threshold_s !== null) ?? null;

    clear(this.meta).append(
      el("span", {
        class: "tool tool--static",
        text: headline ? `MODEL ${headline.model_id}` : "MODEL —",
        title: "which model produced this; a baseline rule is a valid answer and says so",
      }),
      el("span", {
        class: "tool tool--static",
        text: `HORIZON ${forecasts[0] ? Math.round(forecasts[0].horizon_s) : "—"}s`,
      }),
    );

    clear(this.host);
    if (!headline) {
      this.host.append(
        el(
          "div",
          { class: "headline headline--calm" },
          el("div", { class: "headline__time", text: "NO CROSSING" }),
          el("div", {
            class: "headline__zone",
            text: `no zone projected to change band within ${
              forecasts[0] ? Math.round(forecasts[0].horizon_s) : 300
            }s`,
          }),
          el("div", {
            class: "headline__note",
            text: `${forecasts.length} zones under forecast · ${envelope.coverage.unknown} zones unobserved and therefore unforecastable`,
          }),
        ),
      );
      return;
    }

    const row = rows.get(headline.zone_id);
    const actionableNow = actionableIds.has(headline.zone_id);
    this.host.append(
      el(
        "div",
        { class: `headline headline--${actionableNow ? "act" : "watch"}` },
        el("div", { class: "headline__label", text: "TIME TO EVENT" }),
        el("div", { class: "headline__time", text: countdown(headline.time_to_threshold_s) }),
        el(
          "div",
          { class: "headline__zone" },
          el("span", { class: "headline__zonename", text: name(headline.zone_id) }),
          el("span", { class: "headline__arrow", text: " → " }),
          el("span", {
            class: `headline__band headline__band--${headline.target_band}`,
            text: BAND_WORD[headline.target_band],
          }),
        ),
        el(
          "div",
          { class: "headline__claim" },
          el(
            "span",
            { class: "claimbit" },
            el("span", { class: "claimbit__label", text: "PROBABILITY" }),
            el("span", { class: "claimbit__value", text: percent(headline.probability) }),
          ),
          el(
            "span",
            // Weak is "the contract did not call this actionable", never a
            // number compared here.
            { class: `claimbit ${actionableNow ? "" : "claimbit--weak"}` },
            el("span", { class: "claimbit__label", text: "CONFIDENCE" }),
            el("span", { class: "claimbit__value", text: percent(headline.confidence) }),
          ),
          el(
            "span",
            { class: "claimbit" },
            el("span", { class: "claimbit__label", text: "NOW" }),
            el("span", {
              class: "claimbit__value",
              text: row ? `${row.word} ${row.value}` : NO_VALUE,
            }),
          ),
          el(
            "span",
            { class: "claimbit" },
            el("span", { class: "claimbit__label", text: "PROJECTED PEAK" }),
            // Labelled ped/m² deliberately. `Forecast.projected_peak_flow` is
            // documented as ped/m/min, but `BaselinePredictor` extrapolates
            // DENSITY into it (prediction/baseline.py: `current =
            // zone.density_persons_m2`). The field name is wrong, not the value —
            // printing the documented unit would be off by a factor of ~40 and
            // would invite reading a flow number as a band, which is precisely
            // what classifying on density exists to prevent. Flagged for core.
            el("span", {
              class: "claimbit__value",
              text: `${fixed(headline.projected_peak_flow, 2)} ped/m²`,
            }),
          ),
        ),
        !actionableNow &&
          el("div", {
            class: "headline__note",
            text: "below the actionable bar — shown because a weak signal is still a signal",
          }),
        el(
          "ul",
          { class: "causes" },
          ...(headline.causes ?? []).map((cause) => el("li", { text: cause })),
        ),
      ),
    );

    const others = forecasts.filter((f) => f !== headline).slice(0, 6);
    if (others.length === 0) return;
    const table = el("table", { class: "mini" });
    table.append(
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { text: "ZONE" }),
          el("th", { class: "num", text: "T-" }),
          el("th", { text: "TO" }),
          el("th", { class: "num", text: "P" }),
          el("th", { class: "num", text: "CONF" }),
          el("th", { text: "NOW" }),
        ),
      ),
    );
    const body = el("tbody");
    for (const forecast of others) {
      const other = rows.get(forecast.zone_id);
      body.append(
        el(
          "tr",
          { class: actionableIds.has(forecast.zone_id) ? "row--act" : "" },
          el("td", { text: name(forecast.zone_id) }),
          el("td", { class: "num", text: countdown(forecast.time_to_threshold_s) }),
          el("td", { text: BAND_WORD[forecast.target_band] }),
          el("td", { class: "num", text: percent(forecast.probability) }),
          el("td", { class: "num", text: percent(forecast.confidence) }),
          el("td", {}, other ? stateCell(other.word, other.value, other.band ?? "unknown") : NO_VALUE),
        ),
      );
    }
    table.append(body);
    this.host.append(table);
  }

}
