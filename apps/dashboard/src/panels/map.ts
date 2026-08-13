/**
 * The venue map.
 *
 * Schematic, not cartographic — the same choice a timing screen makes. It draws
 * the real imported geometry (2,404 edges and the circuit outline from the
 * pack), but it is a diagram of a network, not a picture of a place: no
 * basemap, no roads, no north arrow. The operator's question is "where is it
 * going wrong and what is next to it", and every pixel spent on cartography is
 * a pixel not spent on that.
 *
 * Three rules the drawing obeys:
 *
 *   * **Shape carries the state as well as colour.** A dot is nominal, a square
 *     is building, a ringed square is critical, a hollow circle is silent and a
 *     cross is unknown. The screen still works in monochrome, at a glance, from
 *     three metres, and for the ~8% of men who will be looking at it.
 *   * **Unknown is drawn, not omitted.** Leaving unobserved zones off the map
 *     would render the venue as calm exactly where the system is blind. Under
 *     opportunistic uplinks that is most of it, so the crosses are deliberately
 *     faint but present, and the legend counts them.
 *   * **Static geometry is cached.** Track and edges are re-rasterised only when
 *     the view changes, so a tick costs one blit plus the live marks.
 */
import type { LOSBand } from "@crowdflow/contracts";
import type { NodeMark, StandardsReport, TickEnvelope, VenueGeometry } from "@crowdflow/api/wire";
import { el, clear } from "../dom";
import { fixed, integer } from "../format";
import type { ZoneRow } from "../model";

const BAND_COLOUR: Record<LOSBand, string> = {
  nominal: "#37d67a",
  building: "#ffb02e",
  critical: "#ff4d4d",
};

const SILENT_COLOUR = "#7f8f9e";
const UNKNOWN_COLOUR = "#4d5a66";
const NODE_COLOUR = "rgba(120, 200, 255, 0.55)";
const EDGE_COLOUR = "#1e262e";
const TRACK_COLOUR = "#55636f";

/** Screen radius of a zone glyph, in CSS pixels. Not a threshold — a size. */
const GLYPH_R = 3.2;
/** How close the pointer must be to pick a zone, in CSS pixels. */
const PICK_RADIUS = 14;

interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export class MapPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly readout: HTMLElement;
  private readonly legend: HTMLElement;

  private geometry: VenueGeometry | null = null;
  private standards: StandardsReport | null = null;
  private rows: ZoneRow[] = [];
  private byId = new Map<string, ZoneRow>();
  private nodes: NodeMark[] = [];
  private view: View = { scale: 1, offsetX: 0, offsetY: 0 };
  private statics: HTMLCanvasElement | null = null;
  private staticKey = "";
  private selected: string | null = null;
  private hovered: string | null = null;
  private dragging: { x: number; y: number } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    readout: HTMLElement,
    legend: HTMLElement,
    private readonly onSelect: (zoneId: string | null) => void,
  ) {
    this.canvas = canvas;
    this.readout = readout;
    this.legend = legend;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2d context unavailable");
    this.context = context;

    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", () => {
      this.hovered = null;
      this.paintReadout();
    });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
  }

  setGeometry(geometry: VenueGeometry, standards: StandardsReport | null): void {
    this.geometry = geometry;
    this.standards = standards;
    this.fit();
    this.paintLegend();
  }

  setSelected(zoneId: string | null): void {
    this.selected = zoneId;
    this.draw();
  }

  update(envelope: TickEnvelope, rows: ZoneRow[]): void {
    this.rows = rows;
    this.byId = new Map(rows.map((row) => [row.id, row]));
    this.nodes = envelope.nodes ?? [];
    this.draw();
    this.paintLegend();
    this.paintReadout();
  }

  // -- view ----------------------------------------------------------------

  /**
   * Bounds of what is actually drawn.
   *
   * Not `frame.venue_bounds_m`: that is the declared envelope the import was
   * clipped to, and it is considerably larger than the graph that survived —
   * fitting to it leaves the venue as a small clump in the middle of a mostly
   * empty panel. The screen should be full of the thing being watched.
   */
  private contentBounds(): [number, number, number, number] {
    const geometry = this.geometry;
    const fallback = geometry?.pack.frame.venue_bounds_m as unknown as
      | [number, number, number, number]
      | undefined;
    if (!geometry) return fallback ?? [0, 0, 1, 1];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const zone of Object.values(geometry.pack.zones ?? {})) {
      include(zone.position.x, zone.position.y);
    }
    for (const point of geometry.track ?? []) include(point.x, point.y);
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
      return fallback ?? [0, 0, 1, 1];
    }
    return [minX, minY, maxX, maxY];
  }

  fit(): void {
    const geometry = this.geometry;
    if (!geometry) return;
    const [minX, minY, maxX, maxY] = this.contentBounds();
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const pad = 18;
    const scale = Math.min(
      (width - pad * 2) / Math.max(maxX - minX, 1),
      (height - pad * 2) / Math.max(maxY - minY, 1),
    );
    this.view = {
      scale,
      offsetX: pad - minX * scale + (width - pad * 2 - (maxX - minX) * scale) / 2,
      offsetY: height - pad + minY * scale - (height - pad * 2 - (maxY - minY) * scale) / 2,
    };
    this.statics = null;
    this.draw();
  }

  private toScreen(x: number, y: number): [number, number] {
    // Venue y is metres north; canvas y grows downward, so it is inverted here
    // and nowhere else.
    return [x * this.view.scale + this.view.offsetX, this.view.offsetY - y * this.view.scale];
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    // The first ResizeObserver callback can arrive before the grid has given the
    // panel a size. A zero-pixel canvas is not an error state to recover from,
    // it is a frame that has not happened yet — so nothing is drawn until the
    // observer reports real dimensions.
    if (width <= 0 || height <= 0) return;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.statics = null;
    if (this.view.scale === 1) this.fit();
    else this.draw();
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const scale = Math.min(Math.max(this.view.scale * factor, 0.02), 6);
    // Keep the point under the cursor fixed while zooming.
    this.view = {
      scale,
      offsetX: px - ((px - this.view.offsetX) / this.view.scale) * scale,
      offsetY: py + ((this.view.offsetY - py) / this.view.scale) * scale,
    };
    this.statics = null;
    this.draw();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.dragging = { x: event.clientX, y: event.clientY };
    const picked = this.pick(event);
    this.selected = picked;
    this.onSelect(picked);
    this.draw();
    this.paintReadout();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.dragging) {
      const dx = event.clientX - this.dragging.x;
      const dy = event.clientY - this.dragging.y;
      this.dragging = { x: event.clientX, y: event.clientY };
      this.view = {
        scale: this.view.scale,
        offsetX: this.view.offsetX + dx,
        offsetY: this.view.offsetY + dy,
      };
      this.statics = null;
      this.draw();
      return;
    }
    const hovered = this.pick(event);
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      this.paintReadout();
      this.draw();
    }
  };

  private onPointerUp = (): void => {
    this.dragging = null;
  };

  private pick(event: PointerEvent): string | null {
    const geometry = this.geometry;
    if (!geometry) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best: string | null = null;
    let bestDistance = PICK_RADIUS;
    for (const [id, zone] of Object.entries(geometry.pack.zones ?? {})) {
      const [x, y] = this.toScreen(zone.position.x, zone.position.y);
      const distance = Math.hypot(x - px, y - py);
      if (distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  }

  // -- drawing -------------------------------------------------------------

  private drawStatics(): HTMLCanvasElement {
    const key = `${this.canvas.width}x${this.canvas.height}:${this.view.scale.toFixed(4)}:${this.view.offsetX.toFixed(1)}:${this.view.offsetY.toFixed(1)}`;
    if (this.statics && this.staticKey === key) return this.statics;

    const dpr = window.devicePixelRatio || 1;
    const layer = document.createElement("canvas");
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext("2d");
    const geometry = this.geometry;
    if (!ctx || !geometry) {
      this.statics = layer;
      this.staticKey = key;
      return layer;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.lineWidth = 1;
    ctx.strokeStyle = EDGE_COLOUR;
    ctx.beginPath();
    const zones = geometry.pack.zones ?? {};
    for (const edge of Object.values(geometry.pack.edges ?? {})) {
      const a = zones[edge.source];
      const b = zones[edge.destination];
      if (!a || !b) continue;
      const [ax, ay] = this.toScreen(a.position.x, a.position.y);
      const [bx, by] = this.toScreen(b.position.x, b.position.y);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    if (geometry.track && geometry.track.length > 1) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = TRACK_COLOUR;
      ctx.beginPath();
      geometry.track.forEach((point, index) => {
        const [x, y] = this.toScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    this.statics = layer;
    this.staticKey = key;
    return layer;
  }

  private draw(): void {
    const ctx = this.context;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    // Same reason as `resize`: an unsized canvas means layout has not run yet.
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    if (!this.geometry) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.drawStatics(), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Devices. Drawn under the zone glyphs so a critical marker is never hidden
    // by the crowd that produced it.
    ctx.fillStyle = NODE_COLOUR;
    for (const node of this.nodes) {
      const [x, y] = this.toScreen(node.x, node.y);
      if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }

    const zones = this.geometry.pack.zones ?? {};
    const labelled: Array<{ x: number; y: number; row: ZoneRow }> = [];

    for (const [id, zone] of Object.entries(zones)) {
      const [x, y] = this.toScreen(zone.position.x, zone.position.y);
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      const row = this.byId.get(id);
      const visibility = row?.visibility ?? "unknown";

      if (visibility === "unknown") {
        // A cross: no data. Faint, because there are hundreds; present, because
        // pretending they are quiet is the failure this product is about.
        ctx.strokeStyle = UNKNOWN_COLOUR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 2);
        ctx.lineTo(x + 2, y + 2);
        ctx.moveTo(x + 2, y - 2);
        ctx.lineTo(x - 2, y + 2);
        ctx.stroke();
        continue;
      }

      if (visibility === "silent") {
        ctx.strokeStyle = SILENT_COLOUR;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, GLYPH_R, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      // An observed payload is required to carry a band. If malformed wire data
      // violates that contract, draw unknown rather than choosing green as a
      // convenient fallback.
      if (!row?.band) {
        ctx.strokeStyle = UNKNOWN_COLOUR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 2);
        ctx.lineTo(x + 2, y + 2);
        ctx.moveTo(x + 2, y - 2);
        ctx.lineTo(x - 2, y + 2);
        ctx.stroke();
        continue;
      }
      const band = row.band;
      ctx.fillStyle = BAND_COLOUR[band];
      if (band === "nominal") {
        ctx.beginPath();
        ctx.arc(x, y, GLYPH_R, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const size = band === "critical" ? GLYPH_R * 2.4 : GLYPH_R * 1.9;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        if (band === "critical") {
          ctx.strokeStyle = BAND_COLOUR.critical;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (row) labelled.push({ x, y, row });
      }
      if (row && !row.reportable) {
        // A reading exists but the contract says do not lean on it. Hollow ring,
        // so the mark reads as provisional rather than measured.
        ctx.strokeStyle = "#0b0e12";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, GLYPH_R * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels last, and only for zones with a reading above NOMINAL. Silent and
    // unknown zones are legible from their glyphs and counted in the legend;
    // labelling them too puts a hundred captions over the venue and buries the
    // three that need reading. The whole point of a schematic is that the quiet
    // 97% does not compete for attention.
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";
    for (const { x, y, row } of labelled.slice(0, 40)) {
      const text = `${row.name} ${row.word} ${row.value}`;
      ctx.fillStyle = "rgba(8,11,14,0.82)";
      const w = ctx.measureText(text).width;
      ctx.fillRect(x + 7, y - 7, w + 6, 14);
      ctx.fillStyle = row.band ? BAND_COLOUR[row.band] : UNKNOWN_COLOUR;
      ctx.fillText(text, x + 10, y);
    }

    for (const id of [this.hovered, this.selected]) {
      if (!id) continue;
      const zone = zones[id];
      if (!zone) continue;
      const [x, y] = this.toScreen(zone.position.x, zone.position.y);
      ctx.strokeStyle = id === this.selected ? "#e8eef4" : "#8fa3b5";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // -- chrome --------------------------------------------------------------

  private paintReadout(): void {
    const id = this.hovered ?? this.selected;
    const row = id ? this.byId.get(id) : undefined;
    clear(this.readout);
    if (!id) {
      this.readout.append(
        el("div", { class: "readout__hint", text: "drag to pan · wheel to zoom · click a zone" }),
      );
      return;
    }
    const zone = this.geometry?.pack.zones?.[id];
    this.readout.append(
      el("div", { class: "readout__name", text: zone?.name ?? id }),
      el("div", { class: "readout__id", text: `${id} · ${zone?.kind ?? "unknown"}` }),
    );
    if (!row) return;
    const facts: Array<[string, string]> =
      row.visibility === "observed"
        ? [
            [row.word, fixed(row.density, 2) + " ped/m²"],
            ["FLOW", fixed(row.flow, 1) + " ped/m/min"],
            ["LOS", row.losGrade],
            ["NODES", integer(row.nodes)],
            ["EST PEOPLE", integer(row.people)],
            ["SPEED", fixed(row.speed, 2) + " m/s"],
            ["NET", fixed(row.net, 1) + " /min"],
            ["QUEUE", integer(row.queue)],
            ["CONF", fixed(row.confidence, 2) + (row.reportable ? "" : " LOW")],
          ]
        : [[row.word, row.value]];
    for (const [label, value] of facts) {
      this.readout.append(
        el(
          "div",
          { class: "readout__row" },
          el("span", { class: "readout__label", text: label }),
          el("span", { class: "readout__value", text: value }),
        ),
      );
    }
  }

  private paintLegend(): void {
    clear(this.legend);
    const counts = { nominal: 0, building: 0, critical: 0, silent: 0, unknown: 0 };
    for (const row of this.rows) {
      if (row.visibility === "observed" && row.band) counts[row.band] += 1;
      else if (row.visibility === "silent") counts.silent += 1;
      else counts.unknown += 1;
    }
    const bands = this.standards?.bands ?? [];
    const range = (band: LOSBand): string => {
      const found = bands.find((b) => b.band === band);
      if (!found) return "";
      return found.density_max === null
        ? `≥ ${found.density_min.toFixed(2)}`
        : `${found.density_min.toFixed(2)}–${found.density_max.toFixed(2)}`;
    };
    const items: Array<[string, string, string, string]> = [
      ["●", "NOMINAL", `${counts.nominal}`, `${range("nominal")} ped/m²`],
      ["■", "BUILDING", `${counts.building}`, `${range("building")} ped/m²`],
      ["◉", "CRITICAL", `${counts.critical}`, `${range("critical")} ped/m²`],
      ["○", "SILENT", `${counts.silent}`, "seen recently, nothing now"],
      ["✕", "UNKNOWN", `${counts.unknown}`, "no reporting device"],
    ];
    for (const [glyph, word, count, note] of items) {
      this.legend.append(
        el(
          "div",
          { class: `legend__item legend__item--${word.toLowerCase()}` },
          el("span", { class: "legend__glyph", text: glyph }),
          el("span", { class: "legend__word", text: word }),
          el("span", { class: "legend__count", text: count }),
          el("span", { class: "legend__note", text: note }),
        ),
      );
    }
  }
}
