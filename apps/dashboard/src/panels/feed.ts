/**
 * Race control.
 *
 * The convention this borrows is deliberate: a timestamped, append-only log of
 * things that changed, in the order they changed, that an operator can read back
 * after looking away. It is the only panel with memory — everything else on this
 * screen shows now, and "when did that start" is a question the other panels
 * cannot answer.
 *
 * Newest first, because the screen is read from three metres and the top line is
 * the one that gets read. Deduped on the sequence number the server assigns, so
 * a reconnection replays history without doubling it.
 */
import type { ConsoleEvent } from "@crowdflow/api/wire";
import { clear, el } from "../dom";
import { clock } from "../format";

/** Lines kept in the DOM. The server's own log is bounded at 400; this is the
 *  same bound, so the panel shows everything the server would replay. */
const MAX_LINES = 400;

export class FeedPanel {
  private seen = new Set<number>();
  private lines = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly counter: HTMLElement,
  ) {}

  reset(): void {
    this.seen.clear();
    this.lines = 0;
    clear(this.host);
  }

  append(events: readonly ConsoleEvent[]): void {
    // Oldest first into the DOM prepend, so the visible order ends up newest-first.
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
      if (this.seen.has(event.seq)) continue;
      this.seen.add(event.seq);
      this.host.prepend(this.render(event));
      this.lines += 1;
    }
    while (this.lines > MAX_LINES && this.host.lastElementChild) {
      this.host.lastElementChild.remove();
      this.lines -= 1;
    }
    clear(this.counter).append(
      el("span", { class: "tool tool--static", text: `${this.lines} LINES` }),
    );
  }

  private render(event: ConsoleEvent): HTMLElement {
    return el(
      "div",
      { class: `feedline feedline--${event.severity} feedline--${event.kind}` },
      el("span", { class: "feedline__time", text: clock(event.time_s) }),
      el("span", { class: "feedline__kind", text: event.kind.toUpperCase() }),
      el("span", { class: "feedline__message", text: event.message }),
      event.detail && el("span", { class: "feedline__detail", text: event.detail }),
    );
  }
}
