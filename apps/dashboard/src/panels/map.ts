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
import { easeOutCubic, layerTransform, revealProgress } from "../mapMotion";
import type { ZoneRow } from "../model";
import { COHORT_CAPACITY, buildPeopleCohorts } from "../cohorts";
import { HEAT_BANDS, heatSpots } from "../heatmap";
import type { Basemap, CrowdLayer, Theme } from "../mapState";
import { satelliteTileUrl, satelliteZoom, tileVenueCorners, visibleTiles, type TileCoordinate } from "../satellite";
import { buildSectorAreas, type SectorArea, type SectorRow } from "../sectors";

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
const PARK_LABEL_FADE_START = 1.8;
const PARK_LABEL_FADE_END = 3;
const ZOOM_ANIMATION_MS = 260;
const GRID_FADE_MS = 220;

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
  private staticView: View | null = null;
  private staticDpr = 1;
  private staticRotation: 0 | 90 | 180 | 270 = 270;
  private selected: string | null = null;
  private hovered: string | null = null;
  private dragging: { x: number; y: number } | null = null;
  private showKinds = false;
  private live: LiveSnapshot | null = null;
  private grid: PeopleQueryResult | null = null;
  private previousGrid: PeopleQueryResult | null = null;
  private showGrid = false;
  private crowd: CrowdLayer = "cohorts";
  private sectors: SectorArea[] = [];
  private sectorRows = new Map<string, SectorRow>();
  private showSectors = true;
  private viewportTimer: number | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private zoomFrame: number | null = null;
  private zoomTargetScale: number | null = null;
  private gridFrame: number | null = null;
  private gridFadeStarted = 0;
  private basemap: Basemap = "schematic";
  private theme: Theme = "dark";
  private tileImages = new Map<string, HTMLImageElement>();
  private satelliteLayer: HTMLCanvasElement | null = null;
  private satelliteKey = "";
  private satelliteView: View | null = null;
  private satelliteDpr = 1;
  private satelliteRotation: 0 | 90 | 180 | 270 = 270;
  private satelliteRevision = 0;
  private satelliteRedrawFrame: number | null = null;

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
    this.sectors = buildSectorAreas(geometry);
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
    const previous = this.grid;
    this.grid = grid;
    if (previous && previous.grid_size_m !== grid.grid_size_m) {
      this.previousGrid = previous;
      this.gridFadeStarted = performance.now();
      this.animateGridFade();
    } else {
      this.previousGrid = null;
    }
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

  setCrowdMode(mode: CrowdLayer): CrowdLayer {
    this.crowd = mode;
    this.draw();
    this.paintLegend();
    this.paintReadout();
    return this.crowd;
  }

  get crowdMode(): CrowdLayer { return this.crowd; }

  setSectors(rows: SectorRow[]): void {
    this.sectorRows = new Map(rows.map((row) => [row.id, row]));
    this.draw();
    this.paintReadout();
  }

  setSectorVisible(visible: boolean): boolean {
    this.showSectors = visible;
    this.statics = null;
    this.draw();
    this.paintLegend();
    this.paintReadout();
    return this.showSectors;
  }

  get sectorsVisible(): boolean { return this.showSectors; }

  setBasemap(basemap: Basemap): Basemap {
    this.basemap = basemap;
    this.invalidateBaseLayers();
    this.draw();
    return this.basemap;
  }

  get basemapMode(): Basemap { return this.basemap; }

  setTheme(theme: Theme): Theme {
    this.theme = theme;
    this.invalidateBaseLayers();
    this.draw();
    this.paintLegend();
    this.paintReadout();
    return this.theme;
  }

  get themeMode(): Theme { return this.theme; }

  private invalidateBaseLayers(): void {
    this.statics = null;
    this.satelliteLayer = null;
  }

  private get viewIsMoving(): boolean {
    return this.dragging !== null || this.zoomFrame !== null;
  }

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
    this.invalidateBaseLayers();
    this.fit();
  }

  /** Rotate orientation 90 degrees clockwise */
  rotate90(): number {
    this.rotation = ((this.rotation + 90) % 360) as 0 | 90 | 180 | 270;
    this.invalidateBaseLayers();
    this.fit();
    return this.rotation;
  }

  /** Toggle between Landscape (0°) and Portrait (90°) views */
  togglePortrait(): boolean {
    this.rotation = (this.rotation === 90 ? 0 : 90);
    this.invalidateBaseLayers();
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
    this.cancelZoom();
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
    this.invalidateBaseLayers();
    this.draw();
    this.emitZoom();
    this.notifyViewport();
  }

  get zoomRatio(): number {
    return this.view.scale / Math.max(this.fitScale, 0.0001);
  }

  zoomBy(factor: number): number {
    return this.animateZoom(factor, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
  }

  focusSector(sectorId: string, zoom = 12): void {
    const sector = this.sectors.find((item) => item.id === sectorId);
    if (!sector) return;
    this.animateTo(sector.x, sector.y, zoom);
  }

  focusZone(zoneId: string, zoom = 14): void {
    const position = this.geometry?.pack.zones?.[zoneId]?.position;
    if (!position) return;
    this.animateTo(position.x, position.y, zoom);
  }

  private animateTo(x: number, y: number, zoom: number): void {
    if (this.canvas.clientWidth <= 0 || this.canvas.clientHeight <= 0) return;
    this.cancelZoom();
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const targetScale = this.fitScale * Math.min(Math.max(zoom, 0.5), 50);
    const [rx, ry] = this.rotateCoord(x, y);
    const startView = { ...this.view };
    const targetView = {
      scale: targetScale,
      offsetX: width / 2 - rx * targetScale,
      offsetY: height / 2 + ry * targetScale,
    };
    const started = performance.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (now: number): void => {
      const progress = reduced ? 1 : easeOutCubic((now - started) / ZOOM_ANIMATION_MS);
      this.view = {
        scale: startView.scale + (targetView.scale - startView.scale) * progress,
        offsetX: startView.offsetX + (targetView.offsetX - startView.offsetX) * progress,
        offsetY: startView.offsetY + (targetView.offsetY - startView.offsetY) * progress,
      };
      if (progress < 1) {
        this.draw();
        this.emitZoom();
        this.zoomFrame = window.requestAnimationFrame(frame);
      } else {
        this.zoomFrame = null;
        this.invalidateBaseLayers();
        this.draw();
        this.emitZoom();
        this.notifyViewport();
      }
    };
    this.zoomFrame = window.requestAnimationFrame(frame);
  }

  restoreView(zoom: number, center: Position | null): void {
    if (!this.geometry) return;
    this.cancelZoom();
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
    this.invalidateBaseLayers();
    this.draw();
    this.emitZoom();
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
    this.invalidateBaseLayers();
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
    this.animateZoom(factor, px, py);
  };

  private animateZoom(factor: number, px: number, py: number): number {
    const minScale = this.fitScale * 0.5;
    const baseScale = this.zoomTargetScale ?? this.view.scale;
    const targetScale = Math.min(Math.max(baseScale * factor, minScale), this.fitScale * 50);
    this.zoomTargetScale = targetScale;
    const startView = { ...this.view };
    const target = this.fromScreen(px, py);
    const [rx, ry] = this.rotateCoord(target.x, target.y);
    if (this.zoomFrame != null) window.cancelAnimationFrame(this.zoomFrame);
    if (this.viewportTimer != null) window.clearTimeout(this.viewportTimer);
    const started = performance.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (now: number): void => {
      const progress = reduced ? 1 : easeOutCubic((now - started) / ZOOM_ANIMATION_MS);
      const scale = startView.scale + (targetScale - startView.scale) * progress;
      this.view = {
        scale,
        offsetX: px - rx * scale,
        offsetY: py + ry * scale,
      };
      if (progress < 1) {
        this.draw();
        this.emitZoom();
        this.zoomFrame = window.requestAnimationFrame(frame);
      } else {
        this.zoomFrame = null;
        this.zoomTargetScale = null;
        this.invalidateBaseLayers();
        this.draw();
        this.emitZoom();
        this.notifyViewport();
      }
    };
    this.zoomFrame = window.requestAnimationFrame(frame);
    return targetScale / Math.max(this.fitScale, 0.0001);
  }

  private cancelZoom(): void {
    if (this.zoomFrame != null) window.cancelAnimationFrame(this.zoomFrame);
    this.zoomFrame = null;
    this.zoomTargetScale = null;
  }

  private emitZoom(): void {
    this.canvas.dispatchEvent(new CustomEvent("mapzoom", { detail: this.zoomRatio }));
  }

  private animateGridFade(): void {
    if (this.gridFrame != null) window.cancelAnimationFrame(this.gridFrame);
    const frame = (now: number): void => {
      this.draw();
      if (now - this.gridFadeStarted < GRID_FADE_MS) {
        this.gridFrame = window.requestAnimationFrame(frame);
      } else {
        this.gridFrame = null;
        this.previousGrid = null;
        this.draw();
      }
    };
    this.gridFrame = window.requestAnimationFrame(frame);
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.cancelZoom();
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
    const moved = this.dragging !== null;
    this.dragging = null;
    if (moved) {
      this.invalidateBaseLayers();
      this.draw();
      this.notifyViewport();
    }
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
    const key = `${this.canvas.width}x${this.canvas.height}:${this.view.scale.toFixed(4)}:${this.view.offsetX.toFixed(1)}:${this.view.offsetY.toFixed(1)}:${this.rotation}:${this.showSectors}:${this.basemap}:${this.theme}`;
    if (this.statics && this.staticKey === key) return this.statics;
    if (this.statics && this.staticView && this.viewIsMoving) return this.statics;

    const dpr = window.devicePixelRatio || 1;
    const layer = document.createElement("canvas");
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext("2d");
    const geometry = this.geometry;
    if (!ctx || !geometry) {
      this.statics = layer;
      this.staticKey = key;
      this.staticView = { ...this.view };
      this.staticDpr = dpr;
      this.staticRotation = this.rotation;
      return layer;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.lineWidth = 1;
    ctx.strokeStyle = this.basemap === "satellite" ? "rgba(231, 242, 251, 0.34)" : this.theme === "light" ? "#b1bec9" : EDGE_COLOUR;
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
      ctx.strokeStyle = this.basemap === "satellite" ? "rgba(255, 255, 255, 0.72)" : this.theme === "light" ? "#536b7d" : TRACK_COLOUR;
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
    const placeLabels = (kind: "viewing" | "parking", colour: string, opacity = 1): void => {
      ctx.save();
      ctx.globalAlpha = opacity;
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
        ctx.fillStyle = this.theme === "light" && this.basemap === "schematic" ? "rgba(255,255,255,0.82)" : "rgba(8,11,14,0.75)";
        ctx.fillRect(...box);
        ctx.fillStyle = colour;
        ctx.fillText(zone.name, x + 7, y);
      }
      ctx.restore();
    };
    if (!this.showSectors && zoomRatio >= STAND_LABEL_MIN_RATIO) placeLabels("viewing", STAND_COLOUR);
    const parkingOpacity = revealProgress(zoomRatio, PARK_LABEL_FADE_START, PARK_LABEL_FADE_END);
    if (parkingOpacity > 0) placeLabels("parking", PARK_COLOUR, parkingOpacity);

    this.statics = layer;
    this.staticKey = key;
    this.staticView = { ...this.view };
    this.staticDpr = dpr;
    this.staticRotation = this.rotation;
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
        ctx.strokeStyle = this.theme === "light" ? "#f7fafc" : "#0b0e12";
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
      ctx.fillStyle = this.theme === "light" && this.basemap === "schematic" ? "rgba(255,255,255,0.88)" : "rgba(8,11,14,0.82)";
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

  private drawGrid(ctx: CanvasRenderingContext2D, grid: PeopleQueryResult, opacity = 1): void {
    const size = grid.grid_size_m;
    const xs = grid.coordinates.map((position) => position.x);
    const ys = grid.coordinates.map((position) => position.y);
    const minX = Math.floor(Math.min(...xs) / size) * size;
    const maxX = Math.ceil(Math.max(...xs) / size) * size;
    const minY = Math.floor(Math.min(...ys) / size) * size;
    const maxY = Math.ceil(Math.max(...ys) / size) * size;
    ctx.save();
    ctx.globalAlpha = opacity;
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
        ctx.fillStyle = this.theme === "light" ? "#132638" : "#d8e2ec";
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

  private drawCohorts(ctx: CanvasRenderingContext2D, grid: PeopleQueryResult, width: number, height: number, opacity = 1): void {
    const cohorts = buildPeopleCohorts(grid);
    ctx.save();
    ctx.globalAlpha = opacity;
    for (const cohort of cohorts) {
      const [x, y] = this.toScreen(cohort.x, cohort.y);
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      const radius = 9 + Math.sqrt(cohort.count / COHORT_CAPACITY) * 5;
      ctx.fillStyle = "rgba(20, 91, 145, 0.92)";
      ctx.strokeStyle = "#79c7ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f4fbff";
      ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(cohort.count), x, y);
    }
    ctx.restore();
  }

  private drawHeatMap(ctx: CanvasRenderingContext2D, grid: PeopleQueryResult, width: number, height: number, opacity = 1): void {
    const spots = heatSpots(grid);
    const colours = Object.fromEntries(HEAT_BANDS.map((band) => [band.band, band.colour]));
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = this.theme === "dark" && this.basemap === "schematic" ? "screen" : "source-over";
    for (const spot of spots) {
      const [x, y] = this.toScreen(spot.x, spot.y);
      const radius = Math.min(90, Math.max(20, grid.grid_size_m * this.view.scale * 0.9));
      if (x < -radius || y < -radius || x > width + radius || y > height + radius) continue;
      const colour = colours[spot.band] ?? "#2b83f6";
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `${colour}d9`);
      gradient.addColorStop(0.42, `${colour}80`);
      gradient.addColorStop(1, `${colour}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    const labelled = [...spots].sort((a, b) => b.density - a.density || b.count - a.count).slice(0, 16);
    const placed: Array<[number, number, number, number]> = [];
    ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const spot of labelled) {
      const [x, y] = this.toScreen(spot.x, spot.y);
      if (x < 28 || y < 12 || x > width - 28 || y > height - 12) continue;
      const text = `${spot.count} · ${spot.density.toFixed(3)}`;
      const boxWidth = ctx.measureText(text).width + 12;
      const box: [number, number, number, number] = [x - boxWidth / 2, y - 9, boxWidth, 18];
      if (placed.some(([px, py, pw, ph]) => box[0] < px + pw + 4 && box[0] + box[2] + 4 > px && box[1] < py + ph + 4 && box[1] + box[3] + 4 > py)) continue;
      placed.push(box);
      ctx.fillStyle = this.theme === "light" && this.basemap === "schematic" ? "rgba(255, 255, 255, 0.92)" : "rgba(7, 12, 18, 0.88)";
      ctx.fillRect(...box);
      ctx.fillStyle = this.theme === "light" && this.basemap === "schematic" ? "#132638" : "#f4fbff";
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  private drawSectors(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const placed: Array<[number, number, number, number]> = [];
    ctx.save();
    ctx.lineJoin = "round";
    for (const sector of this.sectors) {
      if (sector.polygon.length < 3) continue;
      ctx.beginPath();
      sector.polygon.forEach((point, index) => {
        const [x, y] = this.toScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      const isSelected = sector.id === this.selected;
      if (isSelected) {
        ctx.fillStyle = "rgba(88, 182, 255, 0.10)";
        ctx.fill();
      }
      ctx.strokeStyle = isSelected ? "rgba(121, 199, 255, 0.90)" : "rgba(121, 199, 255, 0.26)";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.setLineDash(isSelected ? [] : [5, 5]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const sector of this.sectors) {
      const [x, y] = this.toScreen(sector.x, sector.y);
      if (x < 40 || y < 22 || x > width - 40 || y > height - 22) continue;
      const row = this.sectorRows.get(sector.id);
      const name = sector.name.toUpperCase();
      const detail = this.crowd === "none" || !row ? "SECTOR" : `${integer(row.people)} PEOPLE · ${row.word}`;
      const boxWidth = Math.max(ctx.measureText(name).width, ctx.measureText(detail).width) + 14;
      const box: [number, number, number, number] = [x - boxWidth / 2, y - 17, boxWidth, 34];
      if (placed.some(([px, py, pw, ph]) => box[0] < px + pw + 6 && box[0] + box[2] + 6 > px && box[1] < py + ph + 6 && box[1] + box[3] + 6 > py)) continue;
      placed.push(box);
      ctx.fillStyle = this.theme === "light" && this.basemap === "schematic"
        ? sector.id === this.selected ? "rgba(218, 237, 252, 0.96)" : "rgba(255, 255, 255, 0.90)"
        : sector.id === this.selected ? "rgba(18, 42, 65, 0.96)" : "rgba(7, 12, 18, 0.88)";
      ctx.strokeStyle = sector.id === this.selected ? "#79c7ff" : "rgba(121, 199, 255, 0.48)";
      ctx.lineWidth = 1;
      ctx.fillRect(...box);
      ctx.strokeRect(...box);
      ctx.fillStyle = this.theme === "light" && this.basemap === "schematic" ? "#132638" : "#d8e2ec";
      ctx.fillText(name, x, y - 6);
      ctx.fillStyle = row?.band ? BAND_COLOUR[row.band] : this.theme === "light" ? "#52667a" : "#8a99a9";
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(detail, x, y + 7);
      ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
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
    if (this.basemap === "satellite") {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const satellite = this.drawSatelliteLayer(width, height);
      if (this.satelliteView && this.satelliteRotation === this.rotation) {
        this.drawCachedLayer(ctx, satellite, this.satelliteView, this.satelliteDpr);
      }
      ctx.restore();
    }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const statics = this.drawStatics();
    if (this.staticView && this.staticRotation === this.rotation) {
      this.drawCachedLayer(ctx, statics, this.staticView, this.staticDpr);
    }

    const zones = this.geometry.pack.zones ?? {};
    const gridProgress = this.previousGrid
      ? revealProgress(performance.now(), this.gridFadeStarted, this.gridFadeStarted + GRID_FADE_MS)
      : 1;
    if (this.showGrid && this.previousGrid) this.drawGrid(ctx, this.previousGrid, 1 - gridProgress);
    if (this.showGrid && this.grid) this.drawGrid(ctx, this.grid, gridProgress);
    if (this.showKinds) this.drawKindGlyphs(ctx, zones, width, height);
    else this.drawStateGlyphs(ctx, zones, width, height);
    if (this.crowd === "heatmap") {
      if (this.previousGrid) this.drawHeatMap(ctx, this.previousGrid, width, height, 1 - gridProgress);
      if (this.grid) this.drawHeatMap(ctx, this.grid, width, height, gridProgress);
    } else if (this.crowd === "cohorts") {
      if (this.previousGrid) this.drawCohorts(ctx, this.previousGrid, width, height, 1 - gridProgress);
      if (this.grid) this.drawCohorts(ctx, this.grid, width, height, gridProgress);
    }
    if (this.showSectors) this.drawSectors(ctx, width, height);

    for (const id of [this.hovered, this.selected]) {
      if (!id) continue;
      const zone = zones[id];
      if (!zone) continue;
      const [x, y] = this.toScreen(zone.position.x, zone.position.y);
      ctx.strokeStyle = id === this.selected ? (this.theme === "light" ? "#102437" : "#e8eef4") : "#8fa3b5";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawCachedLayer(
    ctx: CanvasRenderingContext2D,
    layer: HTMLCanvasElement,
    sourceView: View,
    sourceDpr: number,
  ): void {
    const transform = layerTransform(sourceView, this.view);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    ctx.drawImage(layer, 0, 0, layer.width / sourceDpr, layer.height / sourceDpr);
    ctx.restore();
  }

  private drawSatelliteLayer(width: number, height: number): HTMLCanvasElement {
    const dpr = window.devicePixelRatio || 1;
    const key = `${this.canvas.width}x${this.canvas.height}:${this.view.scale.toFixed(4)}:${this.view.offsetX.toFixed(1)}:${this.view.offsetY.toFixed(1)}:${this.rotation}:${this.theme}:${this.satelliteRevision}`;
    if (this.satelliteLayer && this.satelliteKey === key) return this.satelliteLayer;
    if (this.satelliteLayer && this.satelliteView && this.viewIsMoving) return this.satelliteLayer;

    const layer = document.createElement("canvas");
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.paintSatellite(ctx, width, height);
    }
    this.satelliteLayer = layer;
    this.satelliteKey = key;
    this.satelliteView = { ...this.view };
    this.satelliteDpr = dpr;
    this.satelliteRotation = this.rotation;
    return layer;
  }

  private paintSatellite(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const geometry = this.geometry;
    if (!geometry) return;
    const frame = geometry.pack.frame;
    const zoom = satelliteZoom(this.view.scale, frame.origin_lat);
    const corners = [this.fromScreen(0, 0), this.fromScreen(width, 0), this.fromScreen(width, height), this.fromScreen(0, height)];
    for (const tile of visibleTiles(frame, corners, zoom)) {
      const image = this.tileImage(tile);
      if (!image?.complete || image.naturalWidth === 0) continue;
      const [topLeft, topRight, bottomLeft] = tileVenueCorners(frame, tile).map((position) => {
        const [x, y] = this.toScreen(position.x, position.y);
        return { x, y };
      }) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
      ctx.save();
      ctx.transform(
        (topRight.x - topLeft.x) / 256,
        (topRight.y - topLeft.y) / 256,
        (bottomLeft.x - topLeft.x) / 256,
        (bottomLeft.y - topLeft.y) / 256,
        topLeft.x,
        topLeft.y,
      );
      ctx.drawImage(image, -0.25, -0.25, 256.5, 256.5);
      ctx.restore();
    }
    ctx.fillStyle = this.theme === "light" ? "rgba(255, 255, 255, 0.06)" : "rgba(2, 8, 14, 0.24)";
    ctx.fillRect(0, 0, width, height);
  }

  private tileImage(tile: TileCoordinate): HTMLImageElement {
    const key = `${tile.z}/${tile.y}/${tile.x}`;
    const cached = this.tileImages.get(key);
    if (cached) {
      this.tileImages.delete(key);
      this.tileImages.set(key, cached);
      return cached;
    }
    if (this.tileImages.size >= 256) {
      const oldest = this.tileImages.keys().next().value;
      if (oldest) this.tileImages.delete(oldest);
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.addEventListener("load", () => {
      if (this.satelliteRedrawFrame != null) return;
      this.satelliteRedrawFrame = window.requestAnimationFrame(() => {
        this.satelliteRedrawFrame = null;
        this.satelliteRevision += 1;
        if (!this.viewIsMoving) this.satelliteLayer = null;
        if (this.basemap === "satellite") this.draw();
      });
    });
    image.src = satelliteTileUrl(tile);
    this.tileImages.set(key, image);
    return image;
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
      if (this.grid && this.crowd !== "none") {
        this.readout.append(
          el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: this.crowd === "heatmap" ? "HEAT MAP" : "COHORT" }), el("span", { class: "readout__value", text: this.crowd === "heatmap" ? "ped/m²" : `≤ ${COHORT_CAPACITY}` })),
          el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: "IN VIEW" }), el("span", { class: "readout__value", text: integer(this.grid.matched_count) })),
        );
        if (this.showGrid) this.readout.append(
          el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: "GRID" }), el("span", { class: "readout__value", text: `${this.grid.grid_size_m} m` })),
        );
      }
      return;
    }
    const zone = this.geometry?.pack.zones?.[id];
    const sector = this.sectorRows.get(id);
    this.readout.append(
      el("div", { class: "readout__name", text: zone?.name ?? id }),
      el("div", { class: "readout__id", text: `${id} · ${sector ? "sector" : zone?.kind ?? "unknown"}` }),
    );
    if (sector) {
      this.readout.append(
        el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: "LIVE CROWD" }), el("span", { class: "readout__value", text: integer(sector.people) })),
        el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: "STATE" }), el("span", { class: "readout__value", text: sector.word })),
        el("div", { class: "readout__row" }, el("span", { class: "readout__label", text: "ZONES LIVE" }), el("span", { class: "readout__value", text: `${integer(sector.observedZoneCount)}/${integer(sector.zoneCount)}` })),
      );
      return;
    }
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
    if (this.showSectors) this.legend.append(
      el(
        "div",
        { class: "legend__item legend__item--sectors" },
        el("span", { class: "legend__glyph", text: "◇" }),
        el("span", { class: "legend__word", text: "SECTORS" }),
        el("span", { class: "legend__count", text: integer(this.sectors.length) }),
        el("span", { class: "legend__note", text: "live crowd areas" }),
      ),
    );
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
    const people = this.live?.reporting_devices ?? 0;
    const cohorts = buildPeopleCohorts(grid).length;
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
    if (this.crowd === "heatmap") {
      this.legend.append(
        el(
          "div",
          { class: "legend__item legend__item--heatmap" },
          el("span", { class: "legend__word", text: "LIVE DENSITY" }),
          el("span", { class: "legend__heat-gradient", text: "" }),
        ),
      );
      for (const band of HEAT_BANDS) this.legend.append(
        el(
          "div",
          { class: `legend__item legend__item--heat-${band.band}` },
          el("span", { class: "legend__glyph", text: "●" }),
          el("span", { class: "legend__word", text: band.label }),
          el("span", { class: "legend__note", text: band.range }),
        ),
      );
    } else if (this.crowd === "cohorts") this.legend.append(
      el(
        "div",
        { class: "legend__item legend__item--people" },
        el("span", { class: "legend__glyph", text: "●" }),
        el("span", { class: "legend__word", text: "COHORTS" }),
        el("span", { class: "legend__count", text: integer(cohorts) }),
        el("span", { class: "legend__note", text: `up to ${COHORT_CAPACITY} people each` }),
      ),
    );
    this.legend.append(
      el(
        "div",
        { class: "legend__item legend__item--people" },
        el("span", { class: "legend__glyph", text: "Σ" }),
        el("span", { class: "legend__word", text: "LIVE PEOPLE" }),
        el("span", { class: "legend__count", text: integer(people) }),
        el("span", { class: "legend__note", text: "exact reporting total" }),
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
