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
import type { LOSBand, Position, Zone, ZoneKind } from "@crowdflow/contracts";
import type { LiveSnapshot, PeopleQueryResult, StandardsReport, TickEnvelope, VenueGeometry } from "@crowdflow/api/wire";
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
const EDGE_COLOUR = "#1e262e";
const TRACK_COLOUR = "#55636f";

/**
 * Zone-kind palette. Categorical hues validated against the map's dark
 * surface with the dataviz skill's checker (`--pairs all`, since any two
 * kinds can sit next to each other anywhere on the map): blue/aqua/amber
 * clear every CVD and contrast gate together. `concourse` is 87% of zones
 * on Silverstone and carries no distinguishing information of its own — it
 * is the plain pedestrian network the other kinds sit on top of — so it
 * stays on the same muted ink already used for "no data", rather than
 * spending a fourth identity hue on the background.
 */
const GATE_COLOUR = "#3987e5";
const PARK_COLOUR = "#199e70";
const STAND_COLOUR = "#c98500";
const KIND_COLOUR: Record<ZoneKind, string> = {
  gate: GATE_COLOUR,
  parking: PARK_COLOUR,
  viewing: STAND_COLOUR,
  concourse: UNKNOWN_COLOUR,
  crossing: UNKNOWN_COLOUR,
  amenity: UNKNOWN_COLOUR,
  exit: UNKNOWN_COLOUR,
};
const KIND_LABEL: Record<ZoneKind, string> = {
  gate: "GATE",
  parking: "PARKING",
  viewing: "STAND",
  concourse: "CONCOURSE",
  crossing: "CROSSING",
  amenity: "AMENITY",
  exit: "EXIT",
};

/**
 * Zoom ratio (current scale / fit-to-screen scale) past which each tier of
 * named place labels switches on. Stands are the few, genuinely distinct
 * landmarks — Google Maps' "always show the city name" tier — so they are
 * visible from the fitted overview. Parking is 71 zones, 62 of them sharing
 * the literal name "Car park"; showing that tier before the view is zoomed
 * in just stacks duplicate text, so it waits for room to breathe.
 */
const STAND_LABEL_MIN_RATIO = 0;
const PARK_LABEL_MIN_RATIO = 2.5;

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
  private view: View = { scale: 1, offsetX: 0, offsetY: 0 };
  private fitScale = 1;
  // Matches the orientation of the official Silverstone circuit map: Copse
  // top-left, Becketts/Chapel along the top, National Straight/Woodcote/
  // Luffield down the left edge, Stowe/Vale/Club as the right-hand loop.
  private rotation: 0 | 90 | 180 | 270 = 270;
  private statics: HTMLCanvasElement | null = null;
  private staticKey = "";
  private selected: string | null = null;
  private hovered: string | null = null;
  private dragging: { x: number; y: number } | null = null;
  private showKinds = false;
  private live: LiveSnapshot | null = null;
  private grid: PeopleQueryResult | null = null;
  private showGrid = false;
  private viewportTimer: number | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;

  constructor(
    canvas: HTMLCanvasElement,
    readout: HTMLElement,
    legend: HTMLElement,
    private readonly onSelect: (zoneId: string | null) => void,
    private readonly onViewport: (coordinates: Position[], zoom: number) => void,
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

  updateLive(snapshot: LiveSnapshot): void {
    this.live = snapshot;
    this.draw();
    this.paintLegend();
    this.paintReadout();
  }

  setGrid(grid: PeopleQueryResult): void {
    this.grid = grid;
    this.draw();
    this.paintLegend();
    this.paintReadout();
  }

  setGridVisible(showGrid: boolean): boolean {
    this.showGrid = showGrid;
    this.draw();
    this.paintLegend();
    this.paintReadout();
    return this.showGrid;
  }

  get gridVisible(): boolean { return this.showGrid; }

  /**
   * Toggle between the operator's live-state view (nominal/building/critical,
   * silent, unknown) and a zone-kind view (concourse/gate/parking/stand) that
   * shows how the venue's zones are categorised rather than what they are
   * currently reporting.
   */
  toggleKindView(): boolean {
    return this.setKindView(!this.showKinds);
  }

  setKindView(showKinds: boolean): boolean {
    this.showKinds = showKinds;
    this.draw();
    this.paintLegend();
    return this.showKinds;
  }

  get kindView(): boolean { return this.showKinds; }


  /**
   * Set the map orientation. Landscape (0°) shows the venue in its natural
   * aspect; portrait (90°) rotates it 90° clockwise so a wide circuit fills
   * a tall panel better.
   */
  setOrientation(deg: 0 | 90 | 180 | 270): void {
    if (this.rotation === deg) return;
    this.rotation = deg;
    this.statics = null;
    this.fit();
  }

  /** Rotate orientation 90 degrees clockwise */
  rotate90(): number {
    this.rotation = ((this.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    this.statics = null;
    this.fit();
    return this.rotation;
  }

  /** Toggle between Landscape (0°) and Portrait (90°) views */
  togglePortrait(): boolean {
    this.rotation = (this.rotation === 90 ? 0 : 90);
    this.statics = null;
    this.fit();
    return this.rotation === 90;
  }

  get orientationDeg(): 0 | 90 | 180 | 270 { return this.rotation; }

  /** Rotate world coordinates by the current orientation angle. */
  private rotateCoord(x: number, y: number): [number, number] {
    switch (this.rotation) {
      case 0:   return [x, y];
      case 90:  return [y, -x];
      case 180: return [-x, -y];
      case 270: return [-y, x];
    }
  }

  update(_envelope: TickEnvelope, rows: ZoneRow[]): void {
    this.rows = rows;
    this.byId = new Map(rows.map((row) => [row.id, row]));
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
      const [rx, ry] = this.rotateCoord(x, y);
      if (rx < minX) minX = rx;
      if (ry < minY) minY = ry;
      if (rx > maxX) maxX = rx;
      if (ry > maxY) maxY = ry;
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
    this.fitScale = scale;
    this.view = {
      scale,
      offsetX: pad - minX * scale + (width - pad * 2 - (maxX - minX) * scale) / 2,
      offsetY: height - pad + minY * scale - (height - pad * 2 - (maxY - minY) * scale) / 2,
    };
    this.statics = null;
    this.draw();
    this.notifyViewport();
  }

  get zoomRatio(): number {
    return this.view.scale / Math.max(this.fitScale, 0.0001);
  }

  zoomBy(factor: number): number {
    this.zoomAt(factor, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
    return this.zoomRatio;
  }

  restoreView(zoom: number, center: Position | null): void {
    if (!this.geometry) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(Math.max(zoom, 0.5), 50);
    const scale = this.fitScale * ratio;
    const target = center ?? this.fromScreen(width / 2, height / 2);
    const [rx, ry] = this.rotateCoord(target.x, target.y);
    this.view = {
      scale,
      offsetX: width / 2 - rx * scale,
      offsetY: height / 2 + ry * scale,
    };
    this.statics = null;
    this.draw();
    this.notifyViewport();
  }

  private toScreen(x: number, y: number): [number, number] {
    // Venue y is metres north; canvas y grows downward, so it is inverted here
    // and nowhere else.
    const [rx, ry] = this.rotateCoord(x, y);
    return [rx * this.view.scale + this.view.offsetX, this.view.offsetY - ry * this.view.scale];
  }

  private fromScreen(x: number, y: number): Position {
    const rx = (x - this.view.offsetX) / this.view.scale;
    const ry = (this.view.offsetY - y) / this.view.scale;
    switch (this.rotation) {
      case 0: return { x: rx, y: ry };
      case 90: return { x: -ry, y: rx };
      case 180: return { x: -rx, y: -ry };
      case 270: return { x: ry, y: -rx };
    }
  }

  private notifyViewport(): void {
    if (!this.geometry || this.canvas.clientWidth <= 0 || this.canvas.clientHeight <= 0) return;
    if (this.viewportTimer != null) window.clearTimeout(this.viewportTimer);
    this.viewportTimer = window.setTimeout(() => {
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;
      const coordinates = [
        this.fromScreen(0, 0),
        this.fromScreen(width, 0),
        this.fromScreen(width, height),
        this.fromScreen(0, height),
      ];
      this.onViewport(coordinates, this.view.scale / Math.max(this.fitScale, 0.0001));
    }, 120);
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
    const previousCenter = this.geometry && this.viewportWidth > 0 && this.viewportHeight > 0
      ? this.fromScreen(this.viewportWidth / 2, this.viewportHeight / 2)
      : null;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.statics = null;
    const firstSize = this.viewportWidth === 0 || this.viewportHeight === 0;
    this.viewportWidth = width;
    this.viewportHeight = height;
    if (previousCenter) {
      const [rx, ry] = this.rotateCoord(previousCenter.x, previousCenter.y);
      this.view.offsetX = width / 2 - rx * this.view.scale;
      this.view.offsetY = height / 2 + ry * this.view.scale;
    }
    if (firstSize) this.fit();
    else {
      this.draw();
      this.notifyViewport();
    }
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.zoomAt(factor, px, py);
  };

  private zoomAt(factor: number, px: number, py: number): void {
    const minScale = this.fitScale * 0.5;
    const scale = Math.min(Math.max(this.view.scale * factor, minScale), this.fitScale * 50);
    this.view = {
      scale,
      offsetX: px - ((px - this.view.offsetX) / this.view.scale) * scale,
      offsetY: py + ((this.view.offsetY - py) / this.view.scale) * scale,
    };
    this.statics = null;
    this.draw();
    this.notifyViewport();
  }

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
    if (this.dragging) this.notifyViewport();
    this.dragging = null;
  };

  private pick(event: { clientX: number; clientY: number }): string | null {
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
    const key = `${this.canvas.width}x${this.canvas.height}:${this.view.scale.toFixed(4)}:${this.view.offsetX.toFixed(1)}:${this.view.offsetY.toFixed(1)}:${this.rotation}`;
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


    const zoomRatio = this.view.scale / (this.fitScale || this.view.scale || 1);
    const cssWidth = this.canvas.width / dpr;
    const cssHeight = this.canvas.height / dpr;
    const placed: Array<[number, number, number, number]> = [];
    const overlaps = (a: [number, number, number, number]): boolean =>
      placed.some(([px, py, pw, ph]) => a[0] < px + pw && a[0] + a[2] > px && a[1] < py + ph && a[1] + a[3] > py);

    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";
    const placeLabels = (kind: "viewing" | "parking", colour: string): void => {
      for (const zone of Object.values(zones)) {
        if (zone.kind !== kind || !zone.name) continue;
        const [x, y] = this.toScreen(zone.position.x, zone.position.y);
        if (x < -20 || y < -20 || x > cssWidth + 20 || y > cssHeight + 20) continue;
        const w = ctx.measureText(zone.name).width;
        const box: [number, number, number, number] = [x + 5, y - 6, w + 4, 12];
        if (overlaps(box)) continue;
        placed.push(box);
        ctx.fillStyle = colour;
        if (kind === "viewing") ctx.fillRect(x - 2, y - 2, 4, 4);
        else {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(8,11,14,0.75)";
        ctx.fillRect(...box);
        ctx.fillStyle = colour;
        ctx.fillText(zone.name, x + 7, y);
      }
    };
    if (zoomRatio >= STAND_LABEL_MIN_RATIO) placeLabels("viewing", STAND_COLOUR);
    if (zoomRatio >= PARK_LABEL_MIN_RATIO) placeLabels("parking", PARK_COLOUR);

    this.statics = layer;
    this.staticKey = key;
    return layer;
  }


  /** Live operator view: nominal/building/critical, silent, unreportable. */
  private drawStateGlyphs(
    ctx: CanvasRenderingContext2D,
    zones: Record<string, Zone>,
    width: number,
    height: number,
  ): void {
    const labelled: Array<{ x: number; y: number; row: ZoneRow }> = [];

    for (const [id, zone] of Object.entries(zones)) {
      const [x, y] = this.toScreen(zone.position.x, zone.position.y);
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      const row = this.byId.get(id);
      const visibility = row?.visibility ?? "unknown";

      if (visibility === "unknown") {
        // Unknown zones are still counted in the legend, just not drawn — the
        // crosses were burying the signal. Revisit if that trade feels wrong.
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
  }

  /**
   * How the venue's zones are categorised, independent of what they are
   * reporting right now. Only landmark kinds are drawn — gates, parking,
   * stands — so the pedestrian network stays as lines rather than a field of
   * dots. Concourse (87% of Silverstone) is the network itself; marking every
   * junction adds no information the edges do not already carry.
   */
  private drawKindGlyphs(
    ctx: CanvasRenderingContext2D,
    zones: Record<string, Zone>,
    width: number,
    height: number,
  ): void {
    for (const zone of Object.values(zones)) {
      if (zone.kind === "concourse" || zone.kind === "crossing" || zone.kind === "amenity" || zone.kind === "exit") {
        continue;
      }
      const [x, y] = this.toScreen(zone.position.x, zone.position.y);
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      const colour = KIND_COLOUR[zone.kind];
      ctx.fillStyle = colour;
      if (zone.kind === "viewing") {
        ctx.fillRect(x - GLYPH_R / 2, y - GLYPH_R / 2, GLYPH_R, GLYPH_R);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, GLYPH_R * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const grid = this.grid;
    if (!grid) return;
    const size = grid.grid_size_m;
    const xs = grid.coordinates.map((position) => position.x);
    const ys = grid.coordinates.map((position) => position.y);
    const minX = Math.floor(Math.min(...xs) / size) * size;
    const maxX = Math.ceil(Math.max(...xs) / size) * size;
    const minY = Math.floor(Math.min(...ys) / size) * size;
    const maxY = Math.ceil(Math.max(...ys) / size) * size;
    ctx.save();
    for (const cell of grid.cells) {
      const corners = [
        this.toScreen(cell.min_x, cell.min_y),
        this.toScreen(cell.max_x, cell.min_y),
        this.toScreen(cell.max_x, cell.max_y),
        this.toScreen(cell.min_x, cell.max_y),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0]![0], corners[0]![1]);
      for (const [x, y] of corners.slice(1)) ctx.lineTo(x, y);
      ctx.closePath();
      const alpha = Math.min(0.48, 0.08 + Math.log2(cell.count + 1) * 0.07);
      ctx.fillStyle = `rgba(88, 182, 255, ${alpha})`;
      ctx.fill();
      if (size * this.view.scale >= 34) {
        const [x, y] = this.toScreen((cell.min_x + cell.max_x) / 2, (cell.min_y + cell.max_y) / 2);
        ctx.fillStyle = "#d8e2ec";
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(cell.count), x, y);
      }
    }
    ctx.strokeStyle = "rgba(88, 182, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = minX; x <= maxX; x += size) {
      const start = this.toScreen(x, minY);
      const end = this.toScreen(x, maxY);
      ctx.moveTo(start[0], start[1]);
      ctx.lineTo(end[0], end[1]);
    }
    for (let y = minY; y <= maxY; y += size) {
      const start = this.toScreen(minX, y);
      const end = this.toScreen(maxX, y);
      ctx.moveTo(start[0], start[1]);
      ctx.lineTo(end[0], end[1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawPeople(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const nodes = this.live?.nodes ?? [];
    const zoom = this.view.scale / Math.max(this.fitScale, 0.0001);
    const label = zoom >= 4 || nodes.length <= 80;
    const placed: Array<[number, number, number, number]> = [];
    ctx.save();
    for (const node of nodes) {
      const [x, y] = this.toScreen(node.x, node.y);
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      ctx.strokeStyle = "rgba(88, 182, 255, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, Math.min(18, node.accuracy_m * this.view.scale)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#58b6ff";
      ctx.beginPath();
      ctx.arc(x, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (label && node.person_id != null) {
        ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        const text = `#${node.person_id}`;
        const box: [number, number, number, number] = [x + 4, y - 15, ctx.measureText(text).width + 4, 12];
        const overlaps = placed.some(([left, top, boxWidth, boxHeight]) => box[0] < left + boxWidth && box[0] + box[2] > left && box[1] < top + boxHeight && box[1] + box[3] > top);
        if (!overlaps) {
          placed.push(box);
          ctx.fillStyle = "#cfe6ff";
          ctx.fillText(text, x + 5, y - 3);
        }
      }
    }
    ctx.restore();
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

    const zones = this.geometry.pack.zones ?? {};
    if (this.showGrid) this.drawGrid(ctx);
    if (this.showKinds) this.drawKindGlyphs(ctx, zones, width, height);
    else this.drawStateGlyphs(ctx, zones, width, height);
    this.drawPeople(ctx, width, height);

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
      if (this.grid && this.showGrid) {
        this.readout.append(
          el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: "GRID" }), el("span", { class: "readout__value", text: `${this.grid.grid_size_m} m` })),
          el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: "IN VIEW" }), el("span", { class: "readout__value", text: integer(this.grid.matched_count) })),
        );
      }
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
    if (this.showKinds) {
      this.paintKindLegend();
      this.paintLiveLegend();
      return;
    }
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
    this.paintLiveLegend();
  }

  private paintLiveLegend(): void {
    const grid = this.grid;
    const people = this.live?.nodes?.length ?? 0;
    if (this.showGrid) {
      this.legend.append(
      el(
        "div",
        { class: "legend__item legend__item--grid" },
        el("span", { class: "legend__glyph", text: "▦" }),
        el("span", { class: "legend__word", text: grid ? `${grid.grid_size_m} M GRID` : "GRID" }),
        el("span", { class: "legend__count", text: grid ? integer(grid.matched_count) : "0" }),
        el("span", { class: "legend__note", text: "people in viewport" }),
      ));
    }
    this.legend.append(
      el(
        "div",
        { class: "legend__item legend__item--people" },
        el("span", { class: "legend__glyph", text: "●" }),
        el("span", { class: "legend__word", text: "LIVE PEOPLE" }),
        el("span", { class: "legend__count", text: integer(people) }),
        el("span", { class: "legend__note", text: "WebSocket locations" }),
      ),
    );
  }

  /** How the venue's zones break down by kind, independent of live state. */
  private paintKindLegend(): void {
    const zones = this.geometry?.pack.zones ?? {};
    const counts: Record<ZoneKind, number> = {
      concourse: 0, gate: 0, parking: 0, viewing: 0, crossing: 0, amenity: 0, exit: 0,
    };
    for (const zone of Object.values(zones)) counts[zone.kind] += 1;
    const glyph = (kind: ZoneKind): string => (kind === "concourse" || kind === "viewing" ? "■" : "●");
    const note = (kind: ZoneKind): string => {
      switch (kind) {
        case "concourse": return "plain pedestrian network";
        case "gate": return "entry / exit point";
        case "parking": return "car park";
        case "viewing": return "grandstand";
        default: return "";
      }
    };
    const order: ZoneKind[] = ["concourse", "gate", "parking", "viewing", "crossing", "amenity", "exit"];
    for (const kind of order) {
      if (counts[kind] === 0) continue;
      const word = KIND_LABEL[kind];
      this.legend.append(
        el(
          "div",
          { class: `legend__item legend__item--${word.toLowerCase()}` },
          el("span", { class: "legend__glyph", text: glyph(kind) }),
          el("span", { class: "legend__word", text: word }),
          el("span", { class: "legend__count", text: `${counts[kind]}` }),
          el("span", { class: "legend__note", text: note(kind) }),
        ),
      );
    }
  }
}
