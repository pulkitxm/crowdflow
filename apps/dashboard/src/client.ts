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
import type { AgentAskResponse, AgentCommandStatus, AgentStatus, PeopleQueryResult, Position, SessionInfo, SocketFrame, VenueGeometry } from "@crowdflow/api/wire";

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

export function fetchPeopleGrid(circuitId: string, coordinates: Position[], zoom: number, count = 1): Promise<PeopleQueryResult> {
  return json<PeopleQueryResult>(`/api/circuits/${circuitId}/people/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ coordinates, zoom, count, since: Date.now() / 1000 - 30 }),
  });
}

export function askAgent(question: string): Promise<AgentAskResponse> {
  return json<AgentAskResponse>("/api/agent/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
}

export function fetchAgentStatus(): Promise<AgentStatus> {
  return json<AgentStatus>("/api/agent");
}

export function approveProposal(commandId: string): Promise<AgentCommandStatus> {
  return json<AgentCommandStatus>(`/api/agent/proposals/${encodeURIComponent(commandId)}/approve`, { method: "POST" });
}

export function fetchAgentCommands(): Promise<{ commands: AgentCommandStatus[] }> {
  return json<{ commands: AgentCommandStatus[] }>("/api/agent/commands");
}

export function control(action: string, speed?: number): Promise<SessionInfo> {
  return json<SessionInfo>("/api/session/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, speed: speed ?? null }),
  });
}

/**
 * The live phone picture.
 *
 * Polled rather than pushed, and the reason is worth stating: the WebSocket
 * belongs to a scenario session, and live ingest deliberately does not. A venue
 * with real handsets reporting must be watchable without somebody starting a
 * simulation of it, so the two feeds stay independent — and once a second over
 * HTTP is well inside the cadence a crowd changes at.
 *
 * A 404 is not an error here: it means live ingest has not been armed, which is
 * the normal state of a console watching a scenario. Null means "not running",
 * which the panel renders differently from "running and nobody has reported".
 */
export interface LinkHandlers {
  onFrame(frame: SocketFrame): void;
  onLink(state: LinkState, detail: string): void;
}

export class ConsoleLink {
  private backoff = RECONNECT_MIN_MS;
  /** Wall clock of the last frame of any kind — proves the SOCKET is alive. */
  lastFrameAt = 0;

  /**
   * Wall clock of the last TICK frame, which is what the header must count from.
   *
   * Counting from any frame made staleness undetectable: the server sends a
   * STATUS heartbeat every 0.5 s, so the age never exceeded ~0.5 s while the
   * socket was open, and the header's staleness threshold (2 tick periods,
   * 1 s under SPEED=4) could never be reached. A console whose data had stopped
   * arriving minutes ago read "WAITING 0.4s" — which is exactly the reassuring
   * lie this transport exists to prevent. The two clocks answer different
   * questions and must not be conflated.
   */
  lastTickAt = 0;

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
      const now = performance.now();
      this.lastFrameAt = now;
      const frame = JSON.parse(event.data as string) as SocketFrame;
      if (frame.type === "tick") {
        this.lastTickAt = now;
      }
      this.handlers.onLink(["tick", "live", "person_joined", "people_joined"].includes(frame.type) ? "live" : "waiting", frame.session.status);
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
    // Deliberately measured from the last TICK, not the last frame. The header
    // is answering "is the picture current", and a heartbeat proves only that
    // the socket is open. See lastTickAt.
    if (this.lastTickAt === 0) return null;
    return (performance.now() - this.lastTickAt) / 1000;
  }
}
