/**
 * Talking to the API.
 *
 * The link's own state is part of what the console displays. A control-room
 * screen that keeps showing the last frame it received, with no indication that
 * the feed died four minutes ago, is worse than a blank one: it is a confident
 * picture of a venue that has since changed. So `LinkState` is exported, drawn
 * in the header, and the age of the last frame counts up in front of the
 * operator whether or not anything is arriving.
 */
import type { ScenarioOption, SessionInfo, SocketFrame, VenueGeometry } from "@wire";

export type LinkState = "connecting" | "live" | "waiting" | "down";

/** Backoff bounds for reconnecting. ASSUMED: fast enough that a restarted API
 *  is picked up before an operator reaches for the mouse, slow enough not to
 *  hammer a server that is genuinely gone. Nothing is classified on them. */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${url} → ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

export function fetchGeometry(circuitId: string): Promise<VenueGeometry> {
  return json<VenueGeometry>(`/api/circuits/${circuitId}/geometry`);
}

export function fetchScenarios(circuitId: string): Promise<ScenarioOption[]> {
  return json<ScenarioOption[]>(`/api/circuits/${circuitId}/scenarios`);
}

export function control(action: string, speed?: number): Promise<SessionInfo> {
  return json<SessionInfo>("/api/session/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, speed: speed ?? null }),
  });
}

export function startSession(request: Record<string, unknown>): Promise<SessionInfo> {
  return json<SessionInfo>("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

export interface LinkHandlers {
  onFrame(frame: SocketFrame): void;
  onLink(state: LinkState, detail: string): void;
}

export class ConsoleLink {
  private backoff = RECONNECT_MIN_MS;
  /** Wall clock of the last frame of any kind. The header counts up from it. */
  lastFrameAt = 0;

  constructor(private readonly handlers: LinkHandlers) {}

  connect(): void {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${location.host}/ws`;
    this.handlers.onLink("connecting", url);

    const socket = new WebSocket(url);

    socket.onopen = () => {
      this.backoff = RECONNECT_MIN_MS;
    };
    socket.onmessage = (event) => {
      this.lastFrameAt = performance.now();
      const frame = JSON.parse(event.data as string) as SocketFrame;
      this.handlers.onLink(frame.type === "tick" ? "live" : "waiting", frame.session.status);
      this.handlers.onFrame(frame);
    };
    socket.onerror = () => {
      this.handlers.onLink("down", "socket error");
    };
    socket.onclose = (event) => {
      this.handlers.onLink("down", event.reason || `closed ${event.code}`);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    };
  }

  /** Seconds since the last frame, by the console's own clock — not the
   *  server's, because a dead server cannot tell you it is dead. */
  secondsSinceFrame(): number | null {
    if (this.lastFrameAt === 0) return null;
    return (performance.now() - this.lastFrameAt) / 1000;
  }
}
