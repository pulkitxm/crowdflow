import type { ScenarioSnapshot, VenueGeometry } from "@crowdflow/contracts/wire";
import { clear, el, stateCell } from "../dom";
import { NO_VALUE, fixed, integer, signed } from "../format";
import type { ZoneRow } from "../model";

type Tone = "nominal" | "building" | "critical" | "silent" | "unknown";

const SEVERITY: Record<Tone, number> = {
  critical: 0,
  building: 1,
  nominal: 2,
  silent: 3,
  unknown: 4,
};

function tone(row: ZoneRow): Tone {
  if (row.visibility === "unknown") return "unknown";
  if (row.visibility === "silent") return "silent";
  return row.band ?? "nominal";
}

function rank(row: ZoneRow): number {
  return SEVERITY[tone(row)];
}

export class GatesPanel {
  constructor(
    private readonly host: HTMLElement,
    private readonly counter: HTMLElement,
    private readonly onSelect: (zoneId: string) => void,
  ) {}

  private scenario: ScenarioSnapshot | null = null;

  update(rows: readonly ZoneRow[], geometry: VenueGeometry | null, scenario: ScenarioSnapshot | null = null): void {
    this.scenario = scenario;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const zones = geometry?.pack.zones ?? {};
    const portals: ZoneRow[] = Object.values(zones)
      .filter((zone) => zone.kind === "gate" || zone.kind === "exit")
      .map((zone) => {
        const live = byId.get(zone.id);
        if (live) return live;
        return {
          id: zone.id,
          name: zone.name ?? zone.id,
          kind: zone.kind,
          visibility: "unknown" as const,
          word: "UNKNOWN",
          value: "0 nodes",
          band: null,
          density: null,
          flow: null,
          speed: null,
          nodes: 0,
          people: null,
          queue: null,
          net: null,
          confidence: null,
          reportable: false,
          losGrade: NO_VALUE,
          overCapacity: false,
          silentFor: null,
          state: null,
        };
      });

    portals.sort((a, b) => {
      const severity = rank(a) - rank(b);
      if (severity !== 0) return severity;
      const da = a.density;
      const db = b.density;
      if (da === null && db === null) return a.name.localeCompare(b.name);
      if (da === null) return 1;
      if (db === null) return -1;
      if (db !== da) return db - da;
      return a.name.localeCompare(b.name);
    });

    const gates = portals.filter((row) => row.kind === "gate").length;
    const exits = portals.filter((row) => row.kind === "exit").length;
    const hot = portals.filter((row) => row.band === "critical" || row.band === "building").length;
    const disrupted = portals.filter((row) => {
      const availability = scenario?.gates.find((entry) => entry.id === row.id);
      return availability && (!availability.available || availability.capacity_percent < 100);
    }).length;

    clear(this.counter);
    this.counter.append(
      el("span", {
        class: "tool tool--static",
        text: `${gates} GATES · ${exits} EXITS`,
      }),
    );
    if (hot > 0) {
      this.counter.append(
        el("span", {
          class: "tool tool--static",
          text: `${hot} ELEVATED`,
          title: "gates or exits currently building or critical",
        }),
      );
    }
    if (disrupted > 0) this.counter.append(el("span", { class: "tool tool--static gate-disruption", text: `${disrupted} DISRUPTED` }));

    clear(this.host);
    if (!geometry) {
      this.host.append(el("div", { class: "empty", text: "Waiting for venue geometry…" }));
      return;
    }
    if (portals.length === 0) {
      this.host.append(el("div", { class: "empty", text: "This pack has no gates or exit zones." }));
      return;
    }

    for (const row of portals) {
      this.host.append(this.render(row));
    }
  }

  private render(row: ZoneRow): HTMLElement {
    const availability = this.scenario?.gates.find((entry) => entry.id === row.id);
    const status = availability && !availability.available ? "critical" : availability && availability.capacity_percent < 100 ? "building" : tone(row);
    const kind = row.kind === "exit" ? "EXIT" : "GATE";
    const line = el(
      "button",
      {
        class: `gateline gateline--${status}${row.overCapacity ? " gateline--over" : ""}`,
        type: "button",
        title: `Focus ${row.name} on the map`,
      },
      el("span", { class: "gateline__kind", text: row.overCapacity ? `${kind} · OVER CAP` : kind }),
      el("span", { class: "gateline__name", text: row.name }),
      stateCell(availability && !availability.available ? "BLOCKED" : availability && availability.capacity_percent < 100 ? "RESTRICTED" : row.word, availability ? `${availability.capacity_percent}% capacity` : row.visibility === "observed" ? `${row.value} ped/m²` : row.value, status),
      el("span", {
        class: "gateline__metric",
        text: row.net === null ? NO_VALUE : `${signed(row.net, 1)}/min`,
        title: "net flow per minute — positive means filling",
      }),
      el("span", {
        class: "gateline__metric",
        text: row.people === null ? NO_VALUE : `${integer(row.people)} ppl`,
        title: "estimated population at this portal",
      }),
      row.queue !== null && row.queue > 0
        ? el("span", {
            class: "gateline__queue",
            text: `Q ${integer(row.queue)}`,
            title: "people backed up behind this portal",
          })
        : el("span", {
            class: "gateline__metric",
            text: row.flow === null ? NO_VALUE : `${fixed(row.flow, 1)} flow`,
            title: "pedestrians per metre width per minute",
          }),
    );
    line.addEventListener("click", () => this.onSelect(row.id));
    return line;
  }
}
