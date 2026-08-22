import type { AgentAdvisory, AgentAskResponse, AgentCommandStatus, AgentStatus, SpectatorNotice } from "@crowdflow/contracts/wire";
import { answerBlocks, type AnswerSpan } from "../agentAnswer";
import { clear, el } from "../dom";

export interface AgentZoneLink {
  has(zoneId: string): boolean;
  name(zoneId: string): string;
  focus(zoneId: string): void;
}

const ZONE_TOKEN = /[A-Za-z][A-Za-z0-9_]*/g;

export class AgentPanel {
  private busy = false;
  private readonly exchanges: HTMLElement;
  private readonly controlStrip: HTMLElement;
  private readonly advisoryStrip: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;

  constructor(
    host: HTMLElement,
    private readonly meta: HTMLElement,
    private readonly ask: (question: string) => Promise<AgentAskResponse>,
    private readonly zones: AgentZoneLink,
    private readonly approve: (commandId: string) => Promise<AgentCommandStatus>,
  ) {
    this.input = el("input", {
      class: "agent__input",
      type: "text",
      placeholder: "Ask about the venue — e.g. which gate is struggling and what would a reroute cost?",
      "aria-label": "Question for the ops agent",
    });
    this.button = el("button", { class: "tool agent__ask", type: "submit", text: "ASK" });
    const form = el("form", { class: "agent__form" }, this.input, this.button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.exchanges = el("div", { class: "agent__exchanges" }, el("div", { class: "empty", text: "The agent reads the same engines this console renders; it recommends, and only an operator approval dispatches." }));
    this.controlStrip = el("div", { class: "agent__control" });
    this.advisoryStrip = el("div", { class: "agent__advice" });
    clear(host).append(form, this.controlStrip, this.advisoryStrip, this.exchanges);
  }

  setAdvisories(advisories: AgentAdvisory[], notices: SpectatorNotice[], approve: (id: string) => Promise<unknown>): void {
    clear(this.advisoryStrip);
    const open = advisories.filter((advisory) => !advisory.approved);
    this.advisoryStrip.classList.toggle("agent__advice--active", open.length > 0 || notices.length > 0);
    for (const advisory of open) {
      const row = el(
        "div",
        { class: `advice advice--${advisory.severity}`, title: `${advisory.detail} · from ${advisory.model_id}` },
        el("span", { class: "advice__word", text: `${advisory.severity.toUpperCase()} ` }),
        el("span", { class: "advice__headline", text: advisory.headline }),
        el("div", { class: "advice__message", text: `To spectators: “${advisory.crowd_message}”` }),
      );
      const button = el("button", { class: "tool advice__approve", type: "button", text: "APPROVE FOR APP", title: "publish this wording to every spectator phone" });
      button.addEventListener("click", () => {
        button.disabled = true;
        button.textContent = "PUBLISHING…";
        approve(advisory.id).then(
          () => { button.remove(); row.append(el("span", { class: "advice__live", text: " — LIVE ON SPECTATOR APP" })); },
          (error) => { button.disabled = false; button.textContent = "APPROVE FOR APP"; row.append(el("span", { class: "agent-exchange__error", text: ` ${error instanceof Error ? error.message : String(error)}` })); },
        );
      });
      row.append(button);
      this.advisoryStrip.append(row);
    }
    for (const notice of notices) {
      this.advisoryStrip.append(
        el("div", { class: "advice advice--published" },
          el("span", { class: "advice__word", text: "ON APP " }),
          el("span", { class: "advice__headline", text: notice.message }),
        ),
      );
    }
    if (!open.length && !notices.length) {
      this.advisoryStrip.append(el("div", { class: "note", text: "No advisory raised yet — the agent watches every tick and posts one when a forecast, an over-capacity zone or a statistical insight appears." }));
      this.advisoryStrip.classList.add("agent__advice--active");
    }
  }

  setCommands(commands: AgentCommandStatus[]): void {
    clear(this.controlStrip);
    this.controlStrip.classList.toggle("agent__control--active", commands.length > 0);
    for (const command of commands) {
      const cohort = command.cohort;
      this.controlStrip.append(
        el(
          "div",
          { class: "agent-command" },
          el("span", { class: "agent-command__word", text: "CONTROLLING " }),
          this.zoneNode(command.source_zone),
          el("span", { text: " → " }),
          this.zoneNode(command.destination_zone),
          el("span", { class: "agent-command__meta", text: ` ${Math.round(command.target_fraction * 100)}% · T-${Math.max(0, Math.round(command.expires_in_s))}s` }),
          el("span", { class: "agent-command__meta", text: command.applied_to_simulation ? " · steering simulation" : " · guidance only" }),
          el("span", { class: "agent-command__cohort", text: ` · phones: ${cohort.targeted} targeted, ${cohort.pinged} pinged, ${cohort.moved} moved, ${cohort.still_near_source} still at source` }),
        ),
      );
    }
  }

  setStatus(status: AgentStatus | null): void {
    clear(this.meta);
    if (!status) {
      this.meta.append(el("span", { class: "tool tool--static", text: "AGENT UNREACHABLE" }));
      return;
    }
    this.meta.append(el("span", { class: "tool tool--static", text: `PROVIDER ${status.provider.toUpperCase()}` }));
    if (!status.configured) {
      this.meta.append(el("span", { class: "tool tool--static agent__warn", text: "NO KEY", title: status.detail ?? "model API key is not configured on the server" }));
    }
  }

  private async submit(): Promise<void> {
    const question = this.input.value.trim();
    if (!question || this.busy) return;
    this.busy = true;
    this.button.disabled = true;
    this.button.textContent = "ASKING…";
    const pending = el("div", { class: "agent-exchange" }, el("div", { class: "agent-exchange__q", text: question }), el("div", { class: "agent-exchange__wait", text: "reading engine state…" }));
    if (this.exchanges.firstElementChild?.classList.contains("empty")) clear(this.exchanges);
    this.exchanges.prepend(pending);
    try {
      const response = await this.ask(question);
      pending.replaceWith(this.render(response));
      this.input.value = "";
    } catch (error) {
      pending.replaceWith(
        el(
          "div",
          { class: "agent-exchange agent-exchange--failed" },
          el("div", { class: "agent-exchange__q", text: question }),
          el("div", { class: "agent-exchange__error", text: error instanceof Error ? error.message : String(error) }),
        ),
      );
    } finally {
      this.busy = false;
      this.button.disabled = false;
      this.button.textContent = "ASK";
    }
  }

  private render(response: AgentAskResponse): HTMLElement {
    const calls = response.turns.flatMap((turn) => turn.calls);
    const trace = el("details", { class: "agent-trace" }, el("summary", { class: "agent-trace__summary", text: `${calls.length} tool call${calls.length === 1 ? "" : "s"} · ${response.model ?? response.provider} · ${response.state_source.toUpperCase()} state` }));
    for (const call of calls) {
      trace.append(
        el(
          "div",
          { class: "agent-trace__call" },
          el("div", { class: "agent-trace__name", text: `${call.name}(${compact(call.arguments, 120)})` }),
          el("div", { class: "agent-trace__result", text: compact(call.result, 600) }),
        ),
      );
    }
    const exchange = el(
      "div",
      { class: "agent-exchange" },
      el("div", { class: "agent-exchange__q", text: response.question }),
      this.answerNode(response.answer ?? "(the model returned no text)"),
    );
    if (response.truncated) exchange.append(el("div", { class: "agent-exchange__error", text: "stopped at the turn limit — treat the answer as incomplete" }));
    for (const proposal of response.proposals) {
      const row = el(
        "div",
        { class: `agent-proposal agent-proposal--${String(proposal.outcome ?? "unknown")}` },
        el("span", { class: "agent-proposal__word", text: `PROPOSAL ${String(proposal.outcome ?? "?").toUpperCase()} ` }),
        this.zoneNode(String(proposal.source_zone)),
        el("span", { text: " → " }),
        this.zoneNode(String(proposal.destination_zone)),
        el("span", { text: ` · ${Math.round(Number(proposal.target_fraction) * 100)}% · +${String(proposal.expected_cost_s)}s walk — awaiting operator` }),
      );
      if (proposal.outcome === "approved") row.append(this.approveButton(String(proposal.command_id), row));
      exchange.append(row);
    }
    exchange.append(trace);
    return exchange;
  }

  private answerNode(text: string): HTMLElement {
    const host = el("div", { class: "agent-exchange__a" });
    for (const block of answerBlocks(text)) {
      const node = el("div", { class: `agent-md agent-md--${block.kind} agent-md--indent-${block.indent}` });
      if (block.kind === "bullet") node.append(el("span", { class: "agent-md__dot", text: "· " }));
      node.append(...this.spanNodes(block.spans));
      host.append(node);
    }
    return host;
  }

  private spanNodes(spans: AnswerSpan[]): Node[] {
    return spans.flatMap((span) => {
      const nodes = this.linkify(span.text);
      if (!span.bold && !span.code) return nodes;
      const wrap = el("span", { class: span.bold ? "agent-md__bold" : "agent-md__code" });
      wrap.append(...nodes);
      return [wrap];
    });
  }

  private linkify(text: string): Node[] {
    const nodes: Node[] = [];
    let cursor = 0;
    for (const match of text.matchAll(ZONE_TOKEN)) {
      const token = match[0];
      if (!this.zones.has(token)) continue;
      if (match.index > cursor) nodes.push(document.createTextNode(text.slice(cursor, match.index)));
      nodes.push(this.zoneNode(token));
      cursor = match.index + token.length;
    }
    if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)));
    return nodes;
  }

  private approveButton(commandId: string, row: HTMLElement): HTMLElement {
    const button = el("button", { class: "tool agent-proposal__approve", type: "button", text: "APPROVE & DISPATCH", title: "Dispatch this safety-approved reroute: steer the simulation and ping targeted phones with guidance" });
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "DISPATCHING…";
      this.approve(commandId).then(
        (status) => {
          button.remove();
          row.append(el("span", { class: "agent-proposal__dispatched", text: ` — DISPATCHED: ${status.cohort.targeted} phones targeted${status.applied_to_simulation ? ", simulation steering" : ""}, expires in ${Math.round(status.expires_in_s)}s` }));
          this.setCommands([status]);
        },
        (error) => {
          button.disabled = false;
          button.textContent = "APPROVE & DISPATCH";
          row.append(el("span", { class: "agent-exchange__error", text: ` ${error instanceof Error ? error.message : String(error)}` }));
        },
      );
    });
    return button;
  }

  private zoneNode(zoneId: string): Node {
    if (!this.zones.has(zoneId)) return document.createTextNode(zoneId);
    const name = this.zones.name(zoneId);
    const button = el("button", { class: "agent-zone", type: "button", text: zoneId, title: `Show ${name} on the map` });
    button.addEventListener("click", () => this.zones.focus(zoneId));
    return button;
  }
}

function compact(value: Record<string, unknown>, limit: number): string {
  const text = JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
